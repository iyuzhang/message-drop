package com.messagedrop.android

import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.Uri
import android.net.wifi.WifiManager
import android.os.Bundle
import android.os.Environment
import android.util.Log
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.URLUtil
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
import android.widget.Toast
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
  private var retryDiscoveryJob: Job? = null
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
    retryDiscoveryJob?.cancel()
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
    webView.setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
      Log.i(logTag, "download requested url=$url")
      enqueueDownload(url, userAgent, contentDisposition, mimeType)
    }
    webView.webViewClient = object : WebViewClient() {
      override fun shouldOverrideUrlLoading(
        view: WebView?,
        request: WebResourceRequest?,
      ): Boolean {
        val target = request?.url ?: return false
        if (request.isForMainFrame && isFileDownloadUrl(target)) return false
        return false
      }

      @Suppress("OVERRIDE_DEPRECATION")
      override fun onReceivedError(
        view: WebView?,
        request: WebResourceRequest?,
        error: WebResourceError?,
      ) {
        if (request?.isForMainFrame == true) {
          markDisconnectedAndRetry("main-frame-error:${error?.description}")
          return
        }
        super.onReceivedError(view, request, error)
      }

      @Suppress("DEPRECATION")
      override fun onReceivedError(
        view: WebView?,
        errorCode: Int,
        description: String?,
        failingUrl: String?,
      ) {
        val activeUrl = currentBaseUrl
        if (activeUrl != null && failingUrl != null && failingUrl.startsWith(activeUrl)) {
          markDisconnectedAndRetry("legacy-main-frame-error:$description")
          return
        }
        super.onReceivedError(view, errorCode, description, failingUrl)
      }

      override fun onPageFinished(view: WebView?, url: String?) {
        super.onPageFinished(view, url)
        statusSpinner.visibility = View.GONE
      }
    }
  }

  override fun onResume() {
    super.onResume()
    if (currentBaseUrl == null) {
      triggerDiscovery("resume")
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
    retryDiscoveryJob?.cancel()
    retryDiscoveryJob = null
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
        scheduleDiscoveryRetry()
      }
    }
  }

  private fun scheduleDiscoveryRetry() {
    if (currentBaseUrl != null) return
    if (retryDiscoveryJob?.isActive == true) return
    retryDiscoveryJob = lifecycleScope.launch {
      delay(2500)
      if (currentBaseUrl == null) {
        triggerDiscovery("scheduled-retry")
      }
    }
  }

  private fun markDisconnectedAndRetry(reason: String) {
    Log.w(logTag, "mark disconnected: $reason")
    currentBaseUrl = null
    statusSpinner.visibility = View.VISIBLE
    statusText.text = getString(R.string.status_discovering)
    loadOfflineHint()
    triggerDiscovery("recover:$reason")
    scheduleDiscoveryRetry()
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
    retryDiscoveryJob?.cancel()
    retryDiscoveryJob = null
    statusSpinner.visibility = View.GONE
    statusText.text = getString(R.string.status_connected, baseUrl)
    webView.loadUrl(baseUrl)
  }

  private fun isFileDownloadUrl(uri: Uri): Boolean {
    return uri.path?.startsWith("/api/files/") == true
  }

  private fun enqueueDownload(
    url: String,
    userAgent: String?,
    contentDisposition: String?,
    mimeType: String?,
  ) {
    val request = DownloadManager.Request(Uri.parse(url))
    val fileName = URLUtil.guessFileName(url, contentDisposition, mimeType)
    request.setTitle(fileName)
    request.setDescription("Message Drop")
    request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
    request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName)
    if (!mimeType.isNullOrBlank()) {
      request.setMimeType(mimeType)
    }
    if (!userAgent.isNullOrBlank()) {
      request.addRequestHeader("User-Agent", userAgent)
    }
    runCatching {
      val dm = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
      dm.enqueue(request)
      Toast.makeText(this, "Download started", Toast.LENGTH_SHORT).show()
    }.onFailure { e ->
      Log.w(logTag, "enqueue download failed: ${e.message}")
      val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      runCatching { startActivity(intent) }
    }
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
            :root {
              color-scheme: light dark;
            }
            * { box-sizing: border-box; }
            body {
              margin: 0;
              min-height: 100vh;
              display: grid;
              place-items: center;
              padding: 24px;
              font-family: "Noto Sans", system-ui, sans-serif;
              background:
                radial-gradient(1200px 500px at 10% -10%, rgba(59,130,246,.20), transparent),
                radial-gradient(900px 420px at 100% 110%, rgba(16,185,129,.14), transparent),
                #f8fafc;
              color: #0f172a;
            }
            .card {
              width: min(560px, 100%);
              border-radius: 20px;
              background: rgba(255,255,255,.82);
              border: 1px solid rgba(148,163,184,.24);
              box-shadow: 0 10px 30px rgba(15,23,42,.08);
              backdrop-filter: blur(6px);
              padding: 22px 20px;
            }
            .title {
              margin: 0 0 6px;
              font-size: 20px;
              font-weight: 700;
              letter-spacing: .2px;
            }
            .sub {
              margin: 0 0 14px;
              line-height: 1.55;
              color: #334155;
            }
            .pill {
              display: inline-flex;
              align-items: center;
              gap: 8px;
              margin-bottom: 10px;
              border-radius: 999px;
              background: #e2e8f0;
              color: #0f172a;
              padding: 6px 11px;
              font-size: 12px;
              font-weight: 600;
            }
            .dot {
              width: 8px;
              height: 8px;
              border-radius: 50%;
              background: #2563eb;
              animation: pulse 1.2s infinite;
            }
            @keyframes pulse {
              0%,100% { transform: scale(1); opacity: .9; }
              50% { transform: scale(1.35); opacity: .45; }
            }
            .tip {
              margin: 0;
              font-size: 13px;
              color: #475569;
            }
            code {
              background: #e2e8f0;
              color: #0f172a;
              padding: 2px 6px;
              border-radius: 6px;
              font-size: 12px;
            }
          </style>
        </head>
        <body>
          <section class="card">
            <div class="pill"><span class="dot"></span>Trying to reconnect</div>
            <h2 class="title">Message Drop is looking for your server</h2>
            <p class="sub">Please keep this screen open. The app will auto-refresh once your server is online and reachable on the same LAN.</p>
            <p class="tip">Need manual fallback? Long-press the top status and input <code>192.168.31.221:8787</code>.</p>
          </section>
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
