import { useEffect, useRef, useState, useCallback } from 'react'
import mqtt, { MqttClient } from 'mqtt'

export type MqttStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

interface UseMqttOptions {
  brokerUrl: string
  topic: string | string[]
  onMessage: (topic: string, payload: string) => void
  enabled: boolean
}

function toArray(t: string | string[]): string[] {
  return Array.isArray(t) ? t : [t]
}

export function useMqtt({ brokerUrl, topic, onMessage, enabled }: UseMqttOptions) {
  const [status, setStatus] = useState<MqttStatus>('disconnected')
  const [errorMsg, setErrorMsg] = useState('')
  const clientRef = useRef<MqttClient | null>(null)
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage
  const subscribedRef = useRef<string[]>([])

  // Connection
  useEffect(() => {
    if (!enabled) {
      clientRef.current?.end(true)
      clientRef.current = null
      subscribedRef.current = []
      setStatus('disconnected')
      setErrorMsg('')
      return
    }

    setStatus('connecting')
    setErrorMsg('')
    const client = mqtt.connect(brokerUrl, { reconnectPeriod: 5000 })
    clientRef.current = client

    client.on('connect', () => {
      setStatus('connected')
      const topics = toArray(topic)
      topics.forEach(t => client.subscribe(t))
      subscribedRef.current = topics
    })

    client.on('message', (t, payload) => {
      onMessageRef.current(t, payload.toString())
    })

    client.on('error', (err) => {
      setStatus('error')
      setErrorMsg(err.message)
    })

    client.on('close', () => {
      setStatus('disconnected')
      subscribedRef.current = []
    })

    return () => { client.end(true) }
  }, [enabled, brokerUrl]) // eslint-disable-line react-hooks/exhaustive-deps

  // Topic changes — unsubscribe removed, subscribe added
  useEffect(() => {
    const client = clientRef.current
    if (!client || status !== 'connected') return

    const next = toArray(topic)
    const prev = subscribedRef.current

    const toUnsub = prev.filter(t => !next.includes(t))
    const toSub   = next.filter(t => !prev.includes(t))

    toUnsub.forEach(t => client.unsubscribe(t))
    toSub.forEach(t => client.subscribe(t))
    subscribedRef.current = next
  }, [topic, status])

  const disconnect = useCallback(() => {
    clientRef.current?.end(true)
    clientRef.current = null
    subscribedRef.current = []
    setStatus('disconnected')
  }, [])

  const publish = useCallback((topic: string, payload: string) => {
    clientRef.current?.publish(topic, payload)
  }, [])

  return { status, errorMsg, disconnect, publish }
}
