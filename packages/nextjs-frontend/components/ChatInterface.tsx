'use client'

import { useState, useRef, useEffect } from 'react'
import { useMutation, useQuery, useAction } from 'convex/react'
// @ts-ignore - Import from backend package
import { api } from '../../convex-backend/convex/_generated/api'
import { StepIndicator } from './StepIndicator'
import { MessageList } from './MessageList'
import { Send, Loader2 } from 'lucide-react'
import clsx from 'clsx'

interface ChatInterfaceProps {
  sessionId: string
}

export function ChatInterface({ sessionId }: ChatInterfaceProps) {
  const [input, setInput] = useState('')
  const [platforms, setPlatforms] = useState(['LinkedIn', 'X', 'Instagram'])
  const [mode, setMode] = useState<'fast' | 'deep'>('deep')
  const [persona, setPersona] = useState<'author' | 'founder'>('author')
  const [isGenerating, setIsGenerating] = useState(false)
  const [showApproval, setShowApproval] = useState(false)
  const [approvalData, setApprovalData] = useState<any>(null)
  
  const createSession = useMutation(api.sessions.createSession)
  const handleStreamEvent = useMutation(api.streamHandler.handleStreamEvent)
  const addMessage = useMutation(api.messages.addMessage)
  const updateSession = useMutation(api.sessions.updateSession)
  const deleteMessages = useMutation(api.messages.deleteMessages)
  const resetSession = useMutation(api.sessions.resetSession)
  const generateIdeas = useAction(api.actions.generateIdeas)
  const approveResearch = useAction(api.actions.approveResearch)
  const session = useQuery(api.sessions.getSession, { sessionId })
  const messages = useQuery(api.messages.getMessages, { sessionId })

  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Load persona from session if available
  useEffect(() => {
    if (session?.persona) {
      setPersona(session.persona)
    }
  }, [session?.persona])

  // Debug: log messages when they change
  useEffect(() => {
    console.log('Messages updated:', messages?.length, messages)
  }, [messages])


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isGenerating) return

    setIsGenerating(true)
    setShowApproval(false)

    try {
      // Add user message
      await addMessage({
        sessionId,
        type: 'user',
        content: input,
      })

      // Create session in Convex
      await createSession({
        sessionId,
        query: input,
        platforms,
        persona: persona,
      })

      // Call Convex action to generate ideas
      await generateIdeas({
        query: input,
        platforms,
        sessionId,
        persona: persona,
        mode: mode,
      })
    } catch (error) {
      console.error('Error generating ideas:', error)
    } finally {
      setIsGenerating(false)
    }
  }

  const handleApproval = async (action: 'approve' | 'refine' | 'restart', refinement?: string) => {
    if (action === 'restart') {
      // For restart, clear everything and reset to initial state
      setShowApproval(false)
      setApprovalData(null)
      // Keep the existing input (don't clear it)
      setIsGenerating(false)
      
      try {
        // Delete all messages
        await deleteMessages({ sessionId })
        
        // Reset session to initial state (clears research, ideas, etc.)
        await resetSession({
          sessionId,
          query: refinement || session?.query || '',
        })
        
        // Note: Input box will be shown automatically since showApproval is false
        // User can enter a new query and submit, or if refinement was provided,
        // it's already in the input box ready to submit
      } catch (error) {
        console.error('Error restarting:', error)
      }
      return
    }
    
    // For approve and refine, use the existing flow
    setShowApproval(false)
    setIsGenerating(true)

    try {
      if (action === 'approve') {
        // Update status to "generating" immediately when approve is clicked
        await updateSession({
          sessionId,
          status: 'generating',
        })
      } else if (action === 'refine') {
        // For refine, add a user message showing the refinement request
        if (refinement) {
          await addMessage({
            sessionId,
            type: 'user',
            content: `Refinement: ${refinement}`,
          })
        }
        
        // Clear approval data to show empty/loading state for new research
        setApprovalData({
          research: undefined,
          sources: undefined,
          trendingTopics: undefined,
        })
        
        // Reset status to "researching" to start fresh
        await updateSession({
          sessionId,
          status: 'researching',
        })
      }

      // Call Convex action to handle approval
      await approveResearch({
        sessionId,
        action,
        refinement,
      })
    } catch (error) {
      console.error('Error approving:', error)
    } finally {
      setIsGenerating(false)
    }
  }

  useEffect(() => {
    // Show approval panel when researching (to show progress) or waiting for approval
    if ((session?.status === 'researching' || session?.status === 'waiting_approval') && !showApproval) {
      setShowApproval(true)
    }
    
    // Update approval data whenever session data changes (to show research when it completes)
    // Only update if we're waiting for approval (not actively researching new content)
    // This ensures the panel shows empty/loading state during new research after refinement
    if (session && session.status === 'waiting_approval') {
      setApprovalData({
        research: session.research,
        sources: session.sources,
        trendingTopics: session.trendingTopics,
      })
    } else if (session && session.status === 'researching' && !approvalData?.research) {
      // Only set empty state if approvalData doesn't already have research
      // This prevents clearing when we're just showing progress
      setApprovalData({
        research: undefined,
        sources: undefined,
        trendingTopics: undefined,
      })
    }
    
    // Hide approval panel when status is complete or when restarting
    if (session?.status === 'complete' || session?.status === 'generating') {
      setShowApproval(false)
    }
    
    // Clear input when status becomes complete
    if (session?.status === 'complete') {
      setInput('')
    }
  }, [session, showApproval])

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b bg-white px-6 py-3 flex-shrink-0">
        <h1 className="text-2xl font-bold text-gray-900">Marketing Copy Agent</h1>
        <p className="text-sm text-gray-600 mt-1">AI-powered copy generation with human-in-the-loop</p>
      </div>

      {/* Step Indicator */}
      {session && (
        <div className="border-b bg-white px-6 py-2 flex-shrink-0">
          <StepIndicator status={session.status} />
        </div>
      )}

      {/* Messages - Takes up most of the space */}
      <div className="flex-1 overflow-y-auto px-6 py-6 min-h-0">
        <MessageList 
          messages={messages || []}
          approvalData={showApproval ? approvalData : null}
          sessionStatus={session?.status}
          isGenerating={isGenerating}
          onApprove={() => handleApproval('approve')}
          onRefine={(refinement) => handleApproval('refine', refinement)}
          onRestart={(newQuery) => handleApproval('restart', newQuery)}
        />
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      {(!showApproval || session?.status === 'complete' || session?.status === 'researching') && (
        <div className="border-t bg-white px-6 py-4 flex-shrink-0">
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            {/* Controls Row */}
            <div className="flex gap-2 items-center flex-wrap">
              {/* Persona Selector */}
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-700">Persona:</label>
                <select
                  value={persona}
                  onChange={(e) => setPersona(e.target.value as 'author' | 'founder')}
                  disabled={isGenerating}
                  className="px-3 py-2 border border-gray-300 rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="author">Author</option>
                  <option value="founder">Founder</option>
                </select>
              </div>
              
              {/* Mode Toggle */}
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-700">Mode:</label>
                <div className="flex gap-1 px-3 py-2 border border-gray-300 rounded-lg bg-white">
                <label className="flex items-center gap-1 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="mode"
                    value="fast"
                    checked={mode === 'fast'}
                    onChange={(e) => setMode('fast')}
                    disabled={isGenerating}
                    className="w-4 h-4"
                  />
                  <span>Fast</span>
                </label>
                <label className="flex items-center gap-1 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="mode"
                    value="deep"
                    checked={mode === 'deep'}
                    onChange={(e) => setMode('deep')}
                    disabled={isGenerating}
                    className="w-4 h-4"
                  />
                  <span>Deep</span>
                </label>
              </div>
              </div>
              
              {/* Platform Checkboxes */}
              <div className="flex gap-2 px-3 py-2 border border-gray-300 rounded-lg bg-white">
                {['LinkedIn', 'X', 'Instagram', 'Facebook', 'TikTok'].map((platform) => (
                  <label key={platform} className="flex items-center gap-1 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={platforms.includes(platform)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setPlatforms([...platforms, platform])
                        } else {
                          setPlatforms(platforms.filter(p => p !== platform))
                        }
                      }}
                      disabled={isGenerating}
                      className="w-4 h-4"
                    />
                    <span>{platform}</span>
                  </label>
                ))}
              </div>
              
              {/* Submit Button */}
              <button
                type="submit"
                disabled={!input.trim() || isGenerating}
                className={clsx(
                  'px-6 py-2 rounded-lg font-medium transition-colors',
                  isGenerating || !input.trim()
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                )}
              >
                {isGenerating ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Send className="w-5 h-5" />
                )}
              </button>
            </div>
            
            {/* Input Text Row */}
            <div className="flex-1">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Enter your marketing query..."
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={isGenerating}
              />
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
