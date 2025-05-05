const { exec, spawn } = require('child_process')
const { promisify } = require('util')
const path = require('path')
const fs = require('fs')
const os = require('os')

const execAsync = promisify(exec)

// 日志工具
const logger = {
  debug: (...args) => console.log('[ADB Debug]', ...args),
  info: (...args) => console.log('[ADB Info]', ...args),
  error: (...args) => console.error('[ADB Error]', ...args)
}

class AdbManager {
  constructor() {
    logger.info('初始化 AdbManager')
    this.config = this.loadConfig()
    logger.info('当前配置:', this.config)
  }

  getConfigPath() {
    const configPath = path.join(utools.getPath('userData'), 'adb-config.json')
    logger.debug('配置文件路径:', configPath)
    return configPath
  }

  loadConfig() {
    try {
      const configPath = this.getConfigPath()
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
        logger.info('加载配置成功:', config)
        return config
      }
    } catch (error) {
      logger.error('加载配置失败:', error)
    }
    logger.info('使用默认配置')
    return { adbPath: '' }
  }

  saveConfig() {
    try {
      fs.writeFileSync(this.getConfigPath(), JSON.stringify(this.config, null, 2))
      logger.info('保存配置成功:', this.config)
      return true
    } catch (error) {
      logger.error('保存配置失败:', error)
      return false
    }
  }

  async checkAdbInPath() {
    try {
      const command = os.platform() === 'win32' ? 'where adb' : 'which adb'
      logger.debug('检查ADB环境变量, 命令:', command)
      const { stdout } = await execAsync(command)
      const adbPath = stdout.trim()
      logger.info('环境变量中的ADB路径:', adbPath)
      return adbPath
    } catch (error) {
      logger.error('环境变量中未找到ADB:', error)
      return ''
    }
  }

  async isValidAdbPath(adbPath) {
    try {
      logger.debug('验证ADB路径:', adbPath)
      const { stdout } = await execAsync(`"${adbPath}" version`)
      const isValid = stdout.includes('Android Debug Bridge')
      logger.info('ADB路径验证结果:', isValid)
      return isValid
    } catch (error) {
      logger.error('ADB路径验证失败:', error)
      return false
    }
  }

  async init() {
    logger.info('开始初始化ADB')
    if (!this.config.adbPath) {
      logger.info('未配置ADB路径，尝试从环境变量获取')
      const adbInPath = await this.checkAdbInPath()
      if (adbInPath) {
        this.config.adbPath = adbInPath
        this.saveConfig()
        logger.info('已自动配置ADB路径:', adbInPath)
      } else {
        logger.info('未找到ADB路径')
      }
    } else {
      logger.info('使用已配置的ADB路径:', this.config.adbPath)
    }
    return this.config
  }

  async setAdbPath(adbPath) {
    logger.info('设置ADB路径:', adbPath)
    if (await this.isValidAdbPath(adbPath)) {
      this.config.adbPath = adbPath
      this.saveConfig()
      logger.info('ADB路径设置成功')
      return true
    }
    logger.error('无效的ADB路径')
    return false
  }

  getAdbPath() {
    return this.config.adbPath
  }

  async getDevices() {
    try {
      if (!this.config.adbPath) {
        logger.error('未配置ADB路径')
        throw new Error('ADB path not configured')
      }

      logger.debug('执行获取设备命令')
      const { stdout } = await execAsync(`"${this.config.adbPath}" devices`)
      const lines = stdout.split('\n').slice(1)
      const devices = lines
        .map(line => {
          const [id, status] = line.trim().split('\t')
          return id && status === 'device' ? { value: id, label: id } : null
        })
        .filter(Boolean)
      logger.info('获取到的设备列表:', devices)
      return devices
    } catch (error) {
      logger.error('获取设备列表失败:', error)
      return []
    }
  }

  async clearLogcat(deviceId) {
    if (!this.config.adbPath) {
      logger.error('未配置ADB路径')
      throw new Error('ADB path not configured')
    }

    const cmd = `"${this.config.adbPath}" -s ${deviceId} logcat -c`
    logger.debug('执行清除日志命令:', cmd)
    await execAsync(cmd)
  }

  startLogcat(deviceId, filters = []) {
    if (!this.config.adbPath) {
      logger.error('未配置ADB路径')
      throw new Error('ADB path not configured')
    }

    try {
      const filterString = filters
        .map(f => `${f.tag}:${f.level}`)
        .join(' ')
      
      // 使用数组形式的参数，避免命令注入
      const args = ['-s', deviceId, 'logcat', '-v', 'threadtime', '-b', 'main']
      if (filterString) {
        args.push(...filterString.split(' '))
      }
      
      logger.debug('执行logcat命令:', this.config.adbPath, args)
      const process = spawn(this.config.adbPath, args, {
        encoding: 'utf8'
      })

      // 添加进程事件监听
      process.on('spawn', () => {
        logger.info('logcat进程已启动')
      })

      process.on('error', (err) => {
        logger.error('logcat进程错误:', err)
      })

      process.on('close', (code) => {
        logger.info('logcat进程已关闭, 退出码:', code)
      })

      return process
    } catch (error) {
      logger.error('启动logcat失败:', error)
      throw error
    }
  }
}

// 创建单例
logger.info('创建AdbManager实例')
const adbManager = new AdbManager()

// 导出插件功能
window.exports = {
  logcat: {
    mode: 'none',
    args: {
      enter: (action) => {
        logger.info('插件进入:', action)
      }
    }
  }
}

// 包装函数，统一处理错误和返回格式
const wrapMethod = async (methodName, method, ...args) => {
  logger.info(`调用${methodName}:`, ...args)
  try {
    const result = await method.apply(adbManager, args)
    return {
      success: true,
      data: result
    }
  } catch (error) {
    logger.error(`${methodName}失败:`, error)
    return {
      success: false,
      error: error.message
    }
  }
}

// 将adbManager的方法暴露给渲染进程
logger.info('设置window.adb')
window.adb = {
  init: () => wrapMethod('init', adbManager.init),
  setAdbPath: (path) => wrapMethod('setAdbPath', adbManager.setAdbPath, path),
  getAdbPath: () => wrapMethod('getAdbPath', adbManager.getAdbPath),
  getDevices: () => wrapMethod('getDevices', adbManager.getDevices),
  startLogcat: (deviceId, filters) => {
    logger.info('调用startLogcat:', { deviceId, filters })
    try {
      const process = adbManager.startLogcat(deviceId, filters)
      return {
        success: true,
        data: process
      }
    } catch (error) {
      logger.error('startLogcat失败:', error)
      return {
        success: false,
        error: error.message || '启动日志监听失败'
      }
    }
  },
  clearLogcat: (deviceId) => wrapMethod('clearLogcat', adbManager.clearLogcat, deviceId)
}

// 标记初始化完成
window.adbInitialized = true
