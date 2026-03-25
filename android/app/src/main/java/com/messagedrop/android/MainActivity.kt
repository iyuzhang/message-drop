package com.messagedrop.android

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.Uri
import android.net.wifi.WifiManager
import android.os.Bundle
import android.util.Log
import android.webkit.JavascriptInterface
import android.view.View
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.LinearLayout
import android.widget.EditText
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import kotlin.coroutines.resume

class MainActivity : AppCompatActivity() {
  private val logTag = "MessageDrop"
  private lateinit var rootContainer: LinearLayout
  private lateinit var webView: WebView
  private lateinit var statusText: TextView
  private lateinit var statusSpinner: ProgressBar

  private var currentBaseUrl: String? = null
  private var discoverJob: Job? = null
  private var lastDiscoveryAtMs: Long = 0
  private var connectivityManager: ConnectivityManager? = null
  private var networkCallback: ConnectivityManager.NetworkCallback? = null
  private var multicastLock: WifiManager.MulticastLock? = null
  private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
  private val fileChooserLauncher =
    registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
      val callback = fileChooserCallback
      fileChooserCallback = null
      if (callback == null) return@registerForActivityResult
      if (result.resultCode != RESULT_OK) {
        callback.onReceiveValue(null)
        return@registerForActivityResult
      }
      val data = result.data
      val uris =
        when {
          data == null -> emptyArray()
          data.clipData != null -> {
            val clip = data.clipData!!
            Array(clip.itemCount) { i -> clip.getItemAt(i).uri }
          }
          data.data != null -> arrayOf(data.data!!)
          else -> emptyArray()
        }
      callback.onReceiveValue(uris)
    }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    WindowCompat.setDecorFitsSystemWindows(window, false)
    setContentView(R.layout.activity_main)

    rootContainer = findViewById(R.id.rootContainer)
    webView = findViewById(R.id.webView)
    statusText = findViewById(R.id.statusText)
    statusSpinner = findViewById(R.id.statusSpinner)

    configureWindowInsets()
    configureWebView()
    acquireMulticastLock()

    statusText.setOnLongClickListener {
      showManualIpDialog()
      true
    }

    registerNetworkMonitor()
    triggerDiscovery("app-start")
  }

  override fun onDestroy() {
    super.onDestroy()
    discoverJob?.cancel()
    networkCallback?.let { callback ->
      runCatching { connectivityManager?.unregisterNetworkCallback(callback) }
    }
    networkCallback = null
    multicastLock?.let { lock ->
      if (lock.isHeld) lock.release()
    }
    multicastLock = null
  }

  private fun configureWindowInsets() {
    ViewCompat.setOnApplyWindowInsetsListener(rootContainer) { view, windowInsets ->
      val systemBars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars())
      view.setPadding(
        systemBars.left,
        systemBars.top,
        systemBars.right,
        systemBars.bottom,
      )
      windowInsets
    }
  }

  private fun configureWebView() {
    webView.settings.javaScriptEnabled = true
    webView.settings.domStorageEnabled = true
    webView.settings.allowFileAccess = false
    webView.settings.allowContentAccess = false
    webView.addJavascriptInterface(
      AppVersionBridge(BuildConfig.VERSION_NAME),
      "MessageDropAndroid",
    )
    webView.webChromeClient = object : WebChromeClient() {
      override fun onShowFileChooser(
        webView: WebView?,
        filePathCallback: ValueCallback<Array<Uri>>,
        fileChooserParams: FileChooserParams,
      ): Boolean {
        fileChooserCallback?.onReceiveValue(null)
        fileChooserCallback = filePathCallback
        return try {
          val intent = fileChooserParams.createIntent()
          fileChooserLauncher.launch(intent)
          Log.i(logTag, "file chooser opened")
          true
        } catch (e: Exception) {
          Log.w(logTag, "file chooser open failed: ${e.message}")
          fileChooserCallback = null
          false
        }
      }
    }
    webView.webViewClient = object : WebViewClient() {
      override fun onPageFinished(view: WebView?, url: String?) {
        super.onPageFinished(view, url)
        statusSpinner.visibility = View.GONE
      }
    }
  }

  private fun acquireMulticastLock() {
    val wifiManager = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
    multicastLock = wifiManager.createMulticastLock("message-drop-mdns").apply {
      setReferenceCounted(false)
      acquire()
    }
  }

  private fun registerNetworkMonitor() {
    connectivityManager = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    val callback = object : ConnectivityManager.NetworkCallback() {
      override fun onAvailable(network: Network) {
        triggerDiscovery("network-available")
      }

      override fun onLost(network: Network) {
        triggerDiscovery("network-lost")
      }
    }
    connectivityManager?.registerDefaultNetworkCallback(callback)
    networkCallback = callback
  }

  private fun triggerDiscovery(@Suppress("UNUSED_PARAMETER") reason: String) {
    val now = System.currentTimeMillis()
    if (now - lastDiscoveryAtMs < 1500) {
      Log.i(logTag, "triggerDiscovery debounced reason=$reason")
      return
    }
    lastDiscoveryAtMs = now
    if (discoverJob?.isActive == true) {
      Log.i(logTag, "triggerDiscovery skipped; previous run active")
      return
    }
    Log.i(logTag, "triggerDiscovery reason=$reason")
    discoverJob?.cancel()
    discoverJob = lifecycleScope.launch {
      statusSpinner.visibility = View.VISIBLE
      statusText.text = getString(R.string.status_discovering)

      val endpoint = discoverServerWithin(timeoutMs = 2200)
      if (endpoint != null) {
        Log.i(logTag, "discovery success endpoint=$endpoint")
        loadEndpoint(endpoint)
      } else {
        Log.w(logTag, "discovery failed within timeout")
        statusSpinner.visibility = View.GONE
        statusText.text = getString(R.string.status_not_found)
        loadOfflineHint()
      }
    }
  }

  private suspend fun discoverServerWithin(timeoutMs: Long): String? {
    val result = CompletableDeferred<String?>()
    val scope = lifecycleScope

    val udpJob = scope.launch {
      val found = discoverViaUdp(47810, timeoutMs)
      if (found != null) result.complete(found)
    }

    val mdnsJob = scope.launch {
      val found = discoverViaMdns(timeoutMs)
      if (found != null) result.complete(found)
    }

    val timer = scope.launch {
      delay(timeoutMs)
      result.complete(null)
    }

    val winner = result.await()
    udpJob.cancel()
    mdnsJob.cancel()
    timer.cancel()
    return winner
  }

  private suspend fun discoverViaUdp(port: Int, timeoutMs: Long): String? = withContext(Dispatchers.IO) {
    var socket: DatagramSocket? = null
    return@withContext try {
      socket = DatagramSocket(port).apply {
        soTimeout = timeoutMs.toInt()
        broadcast = true
      }
      val packet = DatagramPacket(ByteArray(4096), 4096)
      socket.receive(packet)
      val raw = String(packet.data, 0, packet.length)
      val json = JSONObject(raw)
      if (json.optString("svc") != "message-drop") return@withContext null
      val httpPort = json.optInt("http", 8787)
      val host = packet.address.hostAddress ?: return@withContext null
      Log.i(logTag, "udp discovery host=$host port=$httpPort")
      "http://$host:$httpPort"
    } catch (e: Exception) {
      Log.w(logTag, "udp discovery timeout/failure: ${e.message}")
      null
    } finally {
      socket?.close()
    }
  }

  @Suppress("DEPRECATION")
  private suspend fun discoverViaMdns(timeoutMs: Long): String? =
    suspendCancellableCoroutine { cont ->
      val nsdManager = getSystemService(Context.NSD_SERVICE) as NsdManager
      val targetType = "_message-drop._tcp."

      val resolveListener = object : NsdManager.ResolveListener {
        override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) = Unit

        override fun onServiceResolved(serviceInfo: NsdServiceInfo) {
          if (cont.isCompleted) return
          val host = serviceInfo.host?.hostAddress
          val port = serviceInfo.port
          if (host.isNullOrEmpty() || port <= 0) return
          Log.i(logTag, "mdns resolved host=$host port=$port")
          cont.resume("http://$host:$port")
        }
      }

      val discoveryListener = object : NsdManager.DiscoveryListener {
        override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
          runCatching { nsdManager.stopServiceDiscovery(this) }
          if (!cont.isCompleted) cont.resume(null)
        }

        override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {
          runCatching { nsdManager.stopServiceDiscovery(this) }
        }

        override fun onDiscoveryStarted(serviceType: String) = Unit

        override fun onDiscoveryStopped(serviceType: String) {
          if (!cont.isCompleted) cont.resume(null)
        }

        override fun onServiceFound(serviceInfo: NsdServiceInfo) {
          val sameType = serviceInfo.serviceType == targetType
          if (sameType) {
            runCatching { nsdManager.resolveService(serviceInfo, resolveListener) }
          }
        }

        override fun onServiceLost(serviceInfo: NsdServiceInfo) = Unit
      }

      val timeoutJob = lifecycleScope.launch {
        delay(timeoutMs)
        runCatching { nsdManager.stopServiceDiscovery(discoveryListener) }
        if (!cont.isCompleted) cont.resume(null)
      }

      cont.invokeOnCancellation {
        timeoutJob.cancel()
        runCatching { nsdManager.stopServiceDiscovery(discoveryListener) }
      }

      runCatching {
        nsdManager.discoverServices(targetType, NsdManager.PROTOCOL_DNS_SD, discoveryListener)
      }.onFailure {
        timeoutJob.cancel()
        if (!cont.isCompleted) cont.resume(null)
      }
    }

  private fun loadEndpoint(baseUrl: String) {
    if (baseUrl == currentBaseUrl) return
    Log.i(logTag, "loadEndpoint baseUrl=$baseUrl")
    currentBaseUrl = baseUrl
    statusSpinner.visibility = View.GONE
    statusText.text = getString(R.string.status_connected, baseUrl)
    webView.loadUrl(baseUrl)
  }

  private fun showManualIpDialog() {
    val input = EditText(this)
    input.hint = "192.168.1.10:8787"

    AlertDialog.Builder(this)
      .setTitle("Manual server")
      .setMessage("Fallback when mDNS/UDP fails")
      .setView(input)
      .setNegativeButton("Cancel", null)
      .setPositiveButton("Connect") { _, _ ->
        val value = input.text?.toString()?.trim().orEmpty()
        if (value.isEmpty()) return@setPositiveButton
        val normalized = normalizeManualInput(value)
        loadEndpoint(normalized)
      }
      .show()
  }

  private fun normalizeManualInput(value: String): String {
    return when {
      value.startsWith("http://") || value.startsWith("https://") -> value
      else -> "http://$value"
    }
  }

  private fun loadOfflineHint() {
    val html =
      """
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width,initial-scale=1" />
          <style>
            body { font-family: sans-serif; margin: 0; padding: 20px; color: #111; }
            h2 { margin: 0 0 8px; font-size: 18px; }
            p { margin: 0; line-height: 1.5; }
            code { background: #f2f2f2; padding: 2px 6px; border-radius: 4px; }
          </style>
        </head>
        <body>
          <h2>Waiting for server</h2>
          <p>Auto discovery failed. Long-press the top status text and input manual IP, e.g. <code>192.168.31.221:8787</code>.</p>
        </body>
      </html>
      """.trimIndent()
    webView.loadDataWithBaseURL("about:blank", html, "text/html", "utf-8", null)
  }
}

private class AppVersionBridge(
  private val versionName: String,
) {
  @JavascriptInterface
  fun getAppVersion(): String = versionName
}
