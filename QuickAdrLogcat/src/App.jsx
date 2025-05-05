import { useEffect, useState } from 'react'
import LogcatViewer from './components/LogcatViewer'

export default function App () {
  const [enterAction, setEnterAction] = useState({})

  useEffect(() => {
    window.utools.onPluginEnter((action) => {
      setEnterAction(action)
    })
  }, [])

  return <LogcatViewer />
}
