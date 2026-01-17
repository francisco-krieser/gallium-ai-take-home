'use client'

import { useState } from 'react'
import { ChatInterface } from '@/components/ChatInterface'
import { Sidebar } from '@/components/Sidebar'
import { useQuery } from 'convex/react'
// @ts-ignore - Import from backend package
import { api } from '../../convex-backend/convex/_generated/api'

export default function Home() {
  const [sessionId] = useState(() => `session-${Date.now()}`)
  const session = useQuery(api.sessions.getSession, { sessionId })

  return (
    <div className="flex h-screen bg-gray-50">
      <div className="flex-1 flex flex-col">
        <ChatInterface sessionId={sessionId} />
      </div>
      <Sidebar sessionId={sessionId} />
    </div>
  )
}
