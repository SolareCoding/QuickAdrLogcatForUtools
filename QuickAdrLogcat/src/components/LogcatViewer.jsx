import { useEffect, useState, useRef } from 'react'
import { Select, Input, Button, Tag, Space, Table, Modal, Alert, Spin, message, Checkbox, Dropdown, Menu } from 'antd'
import { SettingOutlined } from '@ant-design/icons';
import LogParserWorker from '../workers/logParser.worker.js?worker'; // 使用 Vite ?worker 语法导入

const LogLevels = {
  V: { color: '#808080', text: 'Verbose' },
  D: { color: '#2196F3', text: 'Debug' },
  I: { color: '#4CAF50', text: 'Info' },
  W: { color: '#FF9800', text: 'Warning' },
  E: { color: '#F44336', text: 'Error' },
  F: { color: '#9C27B0', text: 'Fatal' }
}

// 日志更新防抖间隔 (毫秒)
const LOG_UPDATE_INTERVAL = 300;

export default function LogcatViewer() {
  const [devices, setDevices] = useState([])
  const [selectedDevice, setSelectedDevice] = useState(null)
  const [logs, setLogs] = useState([])
  const [filters, setFilters] = useState([])
  const [newFilter, setNewFilter] = useState({ tag: '', level: 'V' })
  const [frontendFiltering, setFrontendFiltering] = useState(false)
  const [searchKeyword, setSearchKeyword] = useState('')
  const [logProcess, setLogProcess] = useState(null)
  const [adbPath, setAdbPath] = useState('')
  const [isConfigModalVisible, setIsConfigModalVisible] = useState(false)
  const [tempAdbPath, setTempAdbPath] = useState('')
  const [configError, setConfigError] = useState('')
  const [isInitializing, setIsInitializing] = useState(true)
  const [initError, setInitError] = useState('')
  const [logError, setLogError] = useState('')
  const [messageApi, contextHolder] = message.useMessage() // 添加消息提示API

  // 用于暂存从 Worker 接收到的日志
  const logBuffer = useRef([]);
  // 用于存储状态更新的 setTimeout ID
  const logUpdateTimeoutRef = useRef(null);
  // Worker 实例引用
  const workerRef = useRef(null);

  // 日志缓存上限
  const MAX_LOGS = 1000

  // 列显示设置，默认pid和tid隐藏
  const [columnVisibility, setColumnVisibility] = useState({
    timestamp: true,
    pid: false,
    tid: false,
    level: true,
    tag: true,
    message: true
  })

  // 初始化ADB配置
  useEffect(() => {
    const waitForAdb = () => {
      if (window.adb) {
        initAdb()
      } else {
        setTimeout(waitForAdb, 100)
      }
    }

    const initAdb = async () => {
      try {
        const result = await window.adb.init()
        if (!result.success) {
          throw new Error(result.error)
        }
        
        const config = result.data
        setAdbPath(config.adbPath)
        if (!config.adbPath) {
          setIsConfigModalVisible(true)
        }
        setIsInitializing(false)
      } catch (error) {
        console.error('Failed to initialize ADB:', error)
        setInitError(error.message)
        setIsInitializing(false)
      }
    }

    waitForAdb()
  }, [])

  // 初始化和管理 Worker
  useEffect(() => {
    // 创建 Worker
    // 注意: 这里的路径假设你的构建工具 (如 Vite) 支持这种 URL 构造方式
    // 如果使用 Create React App 或其他工具，可能需要不同的设置
    workerRef.current = new LogParserWorker();

    // 监听来自 Worker 的消息
    workerRef.current.onmessage = (event) => {
      if (event.data.type === 'logs') {
        const parsedLogs = event.data.payload;
        if (parsedLogs.length > 0) {
          // 将解析后的日志添加到缓冲区
          logBuffer.current.push(...parsedLogs);

          // 如果已有定时器，清除它
          if (logUpdateTimeoutRef.current) {
            clearTimeout(logUpdateTimeoutRef.current);
          }

          // 设置一个新的定时器，延迟更新主日志状态 (与之前逻辑相同)
          logUpdateTimeoutRef.current = setTimeout(() => {
            const logsToAdd = [...logBuffer.current];
            logBuffer.current = [];

            setLogs(prevLogs => {
              const updatedLogs = [...prevLogs, ...logsToAdd];
              return updatedLogs.slice(-MAX_LOGS);
            });
            logUpdateTimeoutRef.current = null;
          }, LOG_UPDATE_INTERVAL);
        }
      }
    };

    // 处理 Worker 错误
    workerRef.current.onerror = (error) => {
      console.error('Log Parser Worker Error:', error);
      setLogError(`日志解析 Worker 发生错误: ${error.message}`);
      // 可以在这里尝试停止 logcat 或采取其他恢复措施
    };

    // 组件卸载时终止 Worker
    return () => {
      console.log('Terminating Log Parser Worker');
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
       // 清除可能存在的更新定时器
      if (logUpdateTimeoutRef.current) {
        clearTimeout(logUpdateTimeoutRef.current);
        logUpdateTimeoutRef.current = null;
      }
    };
  }, []); // 空依赖数组确保只在挂载和卸载时运行

  // 保存ADB路径
  const saveAdbPath = async () => {
    setConfigError('')
    if (!tempAdbPath) {
      setConfigError('请输入ADB路径')
      return
    }

    const result = await window.adb.setAdbPath(tempAdbPath)
    if (result.success) {
      setAdbPath(tempAdbPath)
      setIsConfigModalVisible(false)
      fetchDevices()
    } else {
      setConfigError(result.error || '无效的ADB路径，请确保路径指向正确的ADB可执行文件')
    }
  }

  // 获取设备列表
  const fetchDevices = async () => {
    try {
      const result = await window.adb.getDevices()
      if (!result.success) {
        throw new Error(result.error)
      }
      setDevices(result.data)
      // 如果有设备且当前没有选中设备，则默认选中第一个
      if (result.data.length > 0 && !selectedDevice && !logProcess) {
        setSelectedDevice(result.data[0].value)
      }
    } catch (error) {
      if (error.message === 'ADB path not configured') {
        setIsConfigModalVisible(true)
      }
    }
  }

  // 启动日志监听
  const startLogcat = async () => {
    if (!selectedDevice) {
      setLogError('请先选择设备')
      return
    }

    try {
      console.log('开始启动logcat, 设备ID:', selectedDevice)
      setLogError('')
      const adbFilters = frontendFiltering ? [] : filters;
      const result = window.adb.startLogcat(selectedDevice, adbFilters)
      console.log('startLogcat result:', result)
      
      if (!result.success) {
        throw new Error(result.error)
      }
      
      console.log('logcat进程已创建')
      const process = result.data
      setLogProcess(process)

      let buffer = '' // 这个 buffer 现在不再需要，因为 Worker 内部处理
      process.stdout.on('data', (data) => {
        // 将原始数据发送给 Worker
        if (workerRef.current) {
          workerRef.current.postMessage({ type: 'process', payload: data.toString() });
        }
      })

      process.stderr.on('data', (data) => {
        const errorMsg = data.toString()
        console.error('Logcat错误输出:', errorMsg)
        setLogError(errorMsg)
      })

      process.on('error', (error) => {
        console.error('Logcat进程错误:', error)
        setLogError(error.message)
      })

      process.on('close', (code) => {
        console.log('Logcat进程已关闭, 退出码:', code)
        setLogProcess(null)
        if (code !== 0) {
          setLogError(`Logcat进程异常退出，退出码: ${code}`)
        }
      })
    } catch (error) {
      console.error('启动logcat失败:', error)
      setLogError(error.message || '启动日志监听失败')
      if (error.message === 'ADB path not configured') {
        setIsConfigModalVisible(true)
      }
    }
  }

  // 停止日志监听
  const stopLogcat = () => {
    // 清除可能存在的更新定时器
    if (logUpdateTimeoutRef.current) {
      clearTimeout(logUpdateTimeoutRef.current);
      logUpdateTimeoutRef.current = null;
    }
    logBuffer.current = [];

    // 停止 Worker (虽然组件卸载时也会停止，但手动停止可以更快释放资源)
    // 注意：如果快速连续点击停止/开始，这里终止再立即新建可能不是最高效的，但逻辑更清晰
    /* // 暂时注释掉这里的 terminate，依赖 useEffect 的清理
    if (workerRef.current) {
      console.log('Stopping: Terminating Log Parser Worker');
      workerRef.current.terminate();
      workerRef.current = null; // 可能需要重新创建 worker on start
    }
    */

    if (logProcess) {
      console.log('停止logcat进程')
      try {
        // 确保进程被彻底关闭
        logProcess.removeAllListeners(); // 移除所有事件监听器
        logProcess.kill();
        
        // 对于 Windows 平台，有时 kill() 不足以终止进程
        // 使用 ADB 直接终止 logcat 进程
        if (selectedDevice) {
          window.adb.stopLogcat(selectedDevice).catch(error => {
            console.error('Failed to force stop logcat:', error);
          });
        }
      } catch (error) {
        console.error('Error stopping logcat process:', error);
      }
      setLogProcess(null)
    }
  }

  // 添加过滤器
  const addFilter = () => {
    if (newFilter.tag) {
      setFilters(prev => [...prev, { ...newFilter }])
      setNewFilter({ tag: '', level: 'V' })
      if (!frontendFiltering) {
        stopLogcat()
        startLogcat()
      }
    }
  }

  // 移除过滤器
  const removeFilter = (index) => {
    setFilters(prev => prev.filter((_, i) => i !== index))
    if (!frontendFiltering) {
      stopLogcat()
      startLogcat()
    }
  }

  // 复制到剪贴板函数
  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text)
      .then(() => {
        messageApi.success('已复制到剪贴板');
      })
      .catch(err => {
        console.error('复制失败:', err);
        messageApi.error('复制失败');
      });
  }

  // 处理行点击事件
  const handleRowClick = (record) => {
    // 构建完整的日志行文本
    const logText = `${record.timestamp} ${record.pid} ${record.tid} ${record.level} ${record.tag}: ${record.message}`;
    copyToClipboard(logText);
  };

  // 表格列定义
  const columns = [
    {
      title: '时间',
      dataIndex: 'timestamp',
      key: 'timestamp',
      width: 180
    },
    {
      title: 'PID',
      dataIndex: 'pid',
      key: 'pid',
      width: 80
    },
    {
      title: 'TID',
      dataIndex: 'tid',
      key: 'tid',
      width: 80
    },
    {
      title: '级别',
      dataIndex: 'level',
      key: 'level',
      width: 80,
      render: (level) => (
        <Tag color={LogLevels[level]?.color}>
          {LogLevels[level]?.text}
        </Tag>
      )
    },
    {
      title: '标签',
      dataIndex: 'tag',
      key: 'tag',
      width: 150
    },
    {
      title: '消息',
      dataIndex: 'message',
      key: 'message',
      ellipsis: true
    }
  ]

  // 过滤列显示
  const visibleColumns = columns.filter(col => columnVisibility[col.dataIndex]);

  // 切换列显示状态
  const toggleColumnVisibility = (key) => {
    // 消息列始终显示
    if (key === 'message') {
      messageApi.info('消息列无法隐藏');
      return;
    }
    
    // 确保至少有一列（消息列）始终可见
    setColumnVisibility(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  // 列配置菜单
  const columnsMenu = (
    <Menu>
      {columns.map(col => (
        <Menu.Item key={col.dataIndex} disabled={col.dataIndex === 'message'}>
          <Checkbox 
            checked={columnVisibility[col.dataIndex]}
            onChange={() => toggleColumnVisibility(col.dataIndex)}
          >
            {col.title}
          </Checkbox>
        </Menu.Item>
      ))}
    </Menu>
  );

  // 定期刷新设备列表
  useEffect(() => {
    if (adbPath) {
      fetchDevices()
    }
  }, [adbPath])

  // 手动刷新设备列表
  const refreshDevices = () => {
    // 不要在日志监控进行中刷新设备列表，这可能导致状态混乱
    if (logProcess) {
      console.log('日志监控进行中，请先停止再刷新设备列表');
      setLogError('日志监控进行中，请先停止再刷新设备列表');
      return;
    }
    if (adbPath) {
      fetchDevices()
    }
  }

  // 清理函数
  useEffect(() => {
    return () => {
      // 组件卸载时执行的操作已移至 Worker 初始化 useEffect 中
      // 这里保留 stopLogcat 是为了确保进程被杀死
      stopLogcat() 
    }
  }, []) // 依赖项为空，确保只在卸载时运行

  // 切换过滤模式
  const toggleFilterMode = (checked) => {
    setFrontendFiltering(checked);
    if (logProcess) {
      stopLogcat();
      setTimeout(() => {
        startLogcat();
      }, 100);
    }
  };

  // 过滤日志
  const filteredLogs = logs.filter(log => {
    if (searchKeyword) {
      const keyword = searchKeyword.toLowerCase()
      const isMatch = (
        log.message.toLowerCase().includes(keyword) ||
        log.tag.toLowerCase().includes(keyword)
      )
      if (!isMatch) return false
    }
    
    if (frontendFiltering && filters.length > 0) {
      return filters.some(filter => {
        const tagMatch = !filter.tag || log.tag.includes(filter.tag);
        const levelMatch = LogLevels[log.level] && LogLevels[filter.level] && 
                           Object.keys(LogLevels).indexOf(log.level) <= Object.keys(LogLevels).indexOf(filter.level);
        return tagMatch && levelMatch;
      });
    }
    
    return true
  })

  // 清除日志
  const clearLogs = async () => {
    try {
      // 清空缓冲区和定时器
      logBuffer.current = [];
      if (logUpdateTimeoutRef.current) {
        clearTimeout(logUpdateTimeoutRef.current);
        logUpdateTimeoutRef.current = null;
      }
      // 通知 worker 清理其内部缓冲
      if (workerRef.current) {
        workerRef.current.postMessage({ type: 'clear' });
      }

      if (selectedDevice) {
        console.log('开始清除日志, 设备ID:', selectedDevice)
        // 记录当前日志监控状态
        const wasRunning = !!logProcess;
        // 先停止日志监听
        stopLogcat()
        // 清除日志缓冲区
        await window.adb.clearLogcat(selectedDevice)
        // 清除界面显示的日志
        setLogs([])
        // 如果之前正在监控日志，则重新开始监听
        if (wasRunning) {
          startLogcat();
        }
      } else {
        // 如果没有选择设备，只清除界面显示的日志
        setLogs([])
      }
    } catch (error) {
      console.error('清除日志失败:', error)
    }
  }

  // 为 adb 模块添加 stopLogcat 功能，在后端进行处理
  useEffect(() => {
    // 添加这个方法到 window.adb 对象，如果它还不存在
    if (window.adb && !window.adb.stopLogcat) {
      window.adb.stopLogcat = async (deviceId) => {
        try {
          // 使用 adb shell 命令强制终止设备上的 logcat 进程
          const result = await window.adb.runCommand(['shell', 'pkill', '-f', 'logcat'], deviceId);
          return { success: true, data: result };
        } catch (error) {
          console.error('强制终止 logcat 失败:', error);
          return { success: false, error: error.message };
        }
      };
    }
  }, []);

  if (isInitializing) {
    return (
      <div style={{ 
        height: '100vh', 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center' 
      }}>
        <Space direction="vertical" align="center">
          <Spin size="large" />
          <div>正在初始化...</div>
        </Space>
      </div>
    )
  }

  if (initError) {
    return (
      <div style={{ padding: 16 }}>
        <Alert
          message="初始化失败"
          description={initError}
          type="error"
          showIcon
        />
      </div>
    )
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {contextHolder} {/* 消息提示组件 */}
      {/* 固定的控制面板 */}
      <div style={{ padding: '16px', flexShrink: 0 }}>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Space>
            <Select
              style={{ width: 200 }}
              options={devices}
              value={selectedDevice}
              onChange={setSelectedDevice}
              placeholder="选择设备"
            />
            <Button onClick={refreshDevices}>
              刷新设备
            </Button>
            <Button
              type="primary"
              onClick={() => logProcess ? stopLogcat() : startLogcat()}
              disabled={!adbPath}
            >
              {logProcess ? '停止' : '开始'}
            </Button>
            <Button onClick={clearLogs}>
              清除日志
            </Button>
            <Button onClick={() => setIsConfigModalVisible(true)}>
              配置ADB
            </Button>
          </Space>

          {!adbPath && (
            <Alert
              message="请先配置ADB路径"
              description="点击'配置ADB'按钮设置ADB可执行文件的路径"
              type="warning"
              showIcon
            />
          )}

          {logError && (
            <Alert
              message="日志监听错误"
              description={logError}
              type="error"
              showIcon
              closable
              onClose={() => setLogError('')}
            />
          )}

          <Space>
            <Input
              style={{ width: 200 }}
              value={newFilter.tag}
              onChange={e => setNewFilter(prev => ({ ...prev, tag: e.target.value }))}
              placeholder="输入标签"
            />
            <Select
              style={{ width: 120 }}
              value={newFilter.level}
              onChange={level => setNewFilter(prev => ({ ...prev, level }))}
              options={Object.entries(LogLevels).map(([value, { text }]) => ({
                value,
                label: text
              }))}
            />
            <Button onClick={addFilter}>添加过滤器</Button>
            <Checkbox 
              checked={frontendFiltering}
              onChange={(e) => toggleFilterMode(e.target.checked)}
            >
              前端过滤
            </Checkbox>
          </Space>

          <Space wrap>
            {frontendFiltering && filters.length > 0 && (
              <Alert 
                message="前端过滤模式已启用" 
                description="过滤器将应用于前端日志显示，而不是 ADB 命令。此模式下可以看到所有日志，但只显示符合过滤条件的条目。"
                type="info" 
                showIcon 
                style={{ marginBottom: '8px' }}
              />
            )}
            {filters.map((filter, index) => (
              <Tag
                key={index}
                closable
                onClose={() => removeFilter(index)}
              >
                {filter.tag}:{filter.level}
              </Tag>
            ))}
          </Space>

          <Space>
            <Input.Search
              placeholder="搜索日志..."
              value={searchKeyword}
              onChange={e => setSearchKeyword(e.target.value)}
              style={{ width: 300 }}
            />
            <Dropdown overlay={columnsMenu} trigger={['click']}>
              <Button icon={<SettingOutlined />}>列设置</Button>
            </Dropdown>
          </Space>
        </Space>
      </div>

      {/* 可滚动的表格区域 */}
      <div style={{ flex: '1', padding: '0 16px 16px', overflow: 'hidden' }}>
        <Table
          columns={visibleColumns}
          dataSource={filteredLogs}
          rowKey={record => record.key}
          size="small"
          scroll={{ y: 'calc(100%)' }}
          pagination={false}
          virtual={true}
          rowHeight={40}
          sticky={{ offsetHeader: 0 }}
          onRow={(record) => ({
            onClick: () => handleRowClick(record), // 点击行时触发
            style: { cursor: 'pointer' } // 鼠标悬停时显示手型光标
          })}
        />
      </div>

      <Modal
        title="配置ADB路径"
        open={isConfigModalVisible}
        onOk={saveAdbPath}
        onCancel={() => setIsConfigModalVisible(false)}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input
            placeholder="请输入ADB可执行文件的完整路径"
            value={tempAdbPath}
            onChange={e => setTempAdbPath(e.target.value)}
          />
          {configError && (
            <Alert message={configError} type="error" showIcon />
          )}
          <Alert
            message="提示"
            description={
              <div>
                <p>1. 如果已将ADB添加到系统环境变量，路径将自动检测</p>
                <p>2. Windows系统通常路径类似：C:\Users\用户名\AppData\Local\Android\Sdk\platform-tools\adb.exe</p>
                <p>3. macOS/Linux系统通常路径类似：/Users/用户名/Library/Android/sdk/platform-tools/adb</p>
              </div>
            }
            type="info"
            showIcon
          />
        </Space>
      </Modal>
    </div>
  )
} 