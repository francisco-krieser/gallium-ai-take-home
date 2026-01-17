'use client'

import { Bot, User, Loader2, FileText, Sparkles } from 'lucide-react'
import clsx from 'clsx'
import { ApprovalPanel } from './ApprovalPanel'

interface Message {
  _id: string
  type: 'user' | 'system' | 'step' | 'research' | 'approval' | 'idea'
  content: string
  platform?: string
  ideas?: string[]
  timestamp: number
}

interface MessageListProps {
  messages: Message[]
  approvalData?: {
    research?: string
    sources?: string[]
    trendingTopics?: Array<{ topic: string; reason: string }>
  } | null
  sessionStatus?: 'researching' | 'waiting_approval' | 'generating' | 'complete'
  isGenerating?: boolean
  onApprove?: () => void
  onRefine?: (refinement: string) => void
  onRestart?: (newQuery: string) => void
}

export function MessageList({ messages, approvalData, sessionStatus, isGenerating, onApprove, onRefine, onRestart }: MessageListProps) {
  if (messages.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        <div className="text-center">
          <Sparkles className="w-12 h-12 mx-auto mb-4 text-gray-400" />
          <p className="text-lg font-medium">Start a conversation</p>
          <p className="text-sm mt-2">Enter a marketing query to begin generating ideas</p>
        </div>
      </div>
    )
  }

  // Filter messages:
  // 1. Hide step messages when status has moved beyond that step
  // 2. Hide system messages that are just JSON strings (research_partial events)
  // 3. Hide idea messages (they're shown in the sidebar)
  // 4. Hide research messages when approval panel is visible (they're shown in the approval panel)
  const filteredMessages = messages.filter((message) => {
    // Filter out idea messages - they're displayed in the sidebar
    if (message.type === 'idea') {
      return false
    }
    
    // Filter out research messages when approval panel is visible (to avoid duplication)
    // But keep them when approval panel is hidden (after ideas are generated)
    // Also keep old research messages when a new research is in progress (refinement scenario)
    if (message.type === 'research' && approvalData && sessionStatus !== 'complete') {
      // Only hide research messages when we're waiting for approval (not actively researching)
      // This allows old research to stay visible when a refinement triggers new research
      if (sessionStatus === 'waiting_approval') {
        // Only hide if this message matches the current research in approval panel
        // This allows multiple research messages to coexist (old + new)
        // Use a fuzzy match since content might have slight differences
        const messageContent = message.content.trim()
        const approvalContent = approvalData.research?.trim() || ''
        if (messageContent === approvalContent || 
            (approvalContent.length > 0 && messageContent.includes(approvalContent.substring(0, 100)))) {
          return false
        }
      }
      // When status is "researching", show all research messages (including old ones)
    }
    
    // Filter out system messages that are just JSON strings
    if (message.type === 'system') {
      const trimmed = message.content.trim()
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
          const parsed = JSON.parse(trimmed)
          // If it's a research_partial event, hide it
          if (parsed.type === 'research_partial') {
            return false
          }
        } catch {
          // Not JSON, keep it
        }
      }
    }
    
    // Hide step messages when status has moved beyond that step
    if (message.type === 'step') {
      // Hide scope/plan messages (research_plan_complete)
      if (message.content.includes('Scope:') || message.content.includes('Tools:')) {
        return false
      }
      
      // Hide trend retrieval messages when research is complete
      if (message.content.includes('Fetching trend') || 
          message.content.includes('trend candidates') ||
          message.content.includes('enriched') ||
          message.content.includes('Found')) {
        // Hide when status is waiting_approval or beyond
        if (sessionStatus === 'waiting_approval' || sessionStatus === 'generating' || sessionStatus === 'complete') {
          return false
        }
      }
      
      if (message.content.includes('Gathering research') || message.content.includes('research')) {
        // Hide research step when status is waiting_approval or beyond
        if (sessionStatus === 'waiting_approval' || sessionStatus === 'generating' || sessionStatus === 'complete') {
          return false
        }
      }
      if (message.content.includes('Generating') || message.content.includes('generating')) {
        // Hide generating step when status is complete
        if (sessionStatus === 'complete') {
          return false
        }
      }
    }
    
    return true
  })

  return (
    <div className="space-y-4">
      {filteredMessages.map((message) => {
        if (message.type === 'user') {
          return (
            <div key={message._id} className="flex justify-end">
              <div className="max-w-2xl bg-blue-600 text-white rounded-lg px-4 py-2">
                <div className="flex items-center gap-2 mb-1">
                  <User className="w-4 h-4" />
                  <span className="text-xs font-medium">You</span>
                </div>
                <p className="text-sm">{message.content}</p>
              </div>
            </div>
          )
        }

        if (message.type === 'step') {
          return (
            <div key={message._id} className="flex items-center gap-2 text-gray-600">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">{message.content}</span>
            </div>
          )
        }

        if (message.type === 'research') {
          return (
            <div key={message._id} className="max-w-2xl bg-gray-100 rounded-lg p-4 border border-gray-200">
              <div className="flex items-center gap-2 mb-2">
                <FileText className="w-4 h-4 text-gray-600" />
                <span className="text-sm font-medium text-gray-900">Research Update</span>
              </div>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{message.content}</p>
            </div>
          )
        }

        // Handle approval messages - update text based on status
        const isApprovalMessage = message.type === 'approval' || 
          message.content.includes('Waiting for your approval') ||
          message.content.includes('Research complete')
        
        if (isApprovalMessage) {
          let displayText = message.content
          if (sessionStatus === 'generating') {
            displayText = 'Research complete. Generating ideas for each specific platform...'
          } else if (sessionStatus === 'complete') {
            displayText = 'Ideas generated successfully! Check the right panel to view platform-specific marketing copy.'
          }
          
          return (
            <div key={message._id} className="flex items-start gap-2">
              <Bot className="w-5 h-5 text-gray-400 mt-1" />
              <div className="max-w-2xl bg-white rounded-lg px-4 py-2 border border-gray-200">
                <p className="text-sm text-gray-700">{displayText}</p>
              </div>
            </div>
          )
        }

        return (
          <div key={message._id} className="flex items-start gap-2">
            <Bot className="w-5 h-5 text-gray-400 mt-1" />
            <div className="max-w-2xl bg-white rounded-lg px-4 py-2 border border-gray-200">
              <p className="text-sm text-gray-700">{message.content}</p>
            </div>
          </div>
        )
      })}
      
      {/* Approval Panel as a message - Hide when status is complete */}
      {approvalData && onApprove && onRefine && onRestart && sessionStatus !== 'complete' && (
        <div className="max-w-2xl">
          <ApprovalPanel
            research={approvalData.research}
            sources={approvalData.sources}
            trendingTopics={approvalData.trendingTopics}
            sessionStatus={sessionStatus}
            isGenerating={isGenerating}
            onApprove={onApprove}
            onRefine={onRefine}
            onRestart={onRestart}
          />
        </div>
      )}
    </div>
  )
}
