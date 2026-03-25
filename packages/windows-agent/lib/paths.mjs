import { homedir } from 'node:os'
import path from 'node:path'

const APP_DIR_NAME = 'message-drop'
const WINDOWS_AGENT_DIR_NAME = 'windows-agent'

export function resolveWindowsAgentPaths(baseEnv = process.env) {
  const userHome = baseEnv.USERPROFILE || homedir()
  const localAppData = baseEnv.LOCALAPPDATA || path.win32.join(userHome, 'AppData', 'Local')
  const roamingAppData = baseEnv.APPDATA || path.win32.join(userHome, 'AppData', 'Roaming')
  const runtimeRoot = path.win32.join(localAppData, APP_DIR_NAME, WINDOWS_AGENT_DIR_NAME)
  const configRoot = path.win32.join(roamingAppData, APP_DIR_NAME, WINDOWS_AGENT_DIR_NAME)

  return {
    userHome,
    localAppData,
    roamingAppData,
    runtimeRoot,
    configRoot,
    logFile: path.win32.join(runtimeRoot, 'agent.log'),
    pidFile: path.win32.join(runtimeRoot, 'agent.pid')
  }
}
