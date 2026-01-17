'use client'

import { useState, useEffect, useRef } from 'react'
import { CheckCircle2, XCircle, RefreshCw, FileText, TrendingUp, ExternalLink, Loader2 } from 'lucide-react'
import clsx from 'clsx'
import ReactMarkdown from 'react-markdown'

interface ApprovalPanelProps {
  research: string | undefined
  sources: string[] | undefined
  trendingTopics: Array<{ 
    topic: string; 
    reason: string; 
    url?: string;
    timestamp?: string;
    confidence?: string;
  }> | undefined
  sessionStatus?: 'researching' | 'waiting_approval' | 'generating' | 'complete'
  isGenerating?: boolean
  onApprove: () => void
  onRefine: (refinement: string) => void
  onRestart: (newQuery: string) => void
}

export function ApprovalPanel({
  research,
  sources,
  trendingTopics,
  sessionStatus,
  isGenerating = false,
  onApprove,
  onRefine,
  onRestart,
}: ApprovalPanelProps) {
  const [refinementMode, setRefinementMode] = useState<'none' | 'refine' | 'restart'>('none')
  const [refinementText, setRefinementText] = useState('')
  const refinementInputRef = useRef<HTMLDivElement>(null)

  // Debug: log when refinement mode changes
  useEffect(() => {
    console.log('ApprovalPanel: refinementMode changed to:', refinementMode)
    // Scroll to refinement input when it appears
    if (refinementMode !== 'none' && refinementInputRef.current) {
      setTimeout(() => {
        refinementInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }, 100)
    }
  }, [refinementMode])

  const handleRefine = () => {
    if (refinementText.trim()) {
      onRefine(refinementText)
      setRefinementText('')
      setRefinementMode('none')
    }
  }

  const handleRestart = () => {
    console.log('handleRestart called, refinementText:', refinementText)
    // For restart, pass the new query (or empty to use original)
    // The parent will handle clearing messages and resetting state
    onRestart(refinementText.trim() || '')
    setRefinementText('')
    setRefinementMode('none')
  }

  return (
    <div className="bg-blue-50 rounded-lg border-2 border-blue-200 shadow-sm flex flex-col h-[60vh] overflow-hidden my-4">
      {/* Fixed Header */}
      <div className="p-4 flex-shrink-0 border-b border-blue-200 bg-white rounded-t-lg">
        <div className="flex items-center gap-2 mb-2">
          {sessionStatus === 'waiting_approval' ? (
            <CheckCircle2 className="w-5 h-5 text-blue-600" />
          ) : (
            <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
          )}
          <h3 className="text-lg font-semibold text-gray-900">
            {sessionStatus === 'waiting_approval' ? 'Research Complete' : 'Researching...'}
          </h3>
        </div>
        <p className="text-sm text-gray-600">
          {sessionStatus === 'waiting_approval' ? (
            'Review the research findings below. You can approve to proceed with idea generation, request refinements, or restart with a new query.'
          ) : (
            'Gathering research and insights. This may take a moment...'
          )}
        </p>
      </div>

      {/* Scrollable Content Area */}
      <div className="flex-1 overflow-y-auto p-4 min-h-0">
            {/* Research Summary - Single div that changes content based on status */}
            <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
              <div className="flex items-center gap-2 mb-2">
                {research ? (
                  <FileText className="w-4 h-4 text-gray-600" />
                ) : (
                  <Loader2 className="w-4 h-4 text-gray-600 animate-spin" />
                )}
                <h4 className="font-medium text-gray-900">Research Summary</h4>
              </div>
              {research ? (
                <div className="text-sm text-gray-700 prose prose-sm max-w-none">
                  <ReactMarkdown
                    components={{
                      h1: ({node, ...props}) => <h1 className="text-lg font-bold mt-4 mb-2 text-gray-900" {...props} />,
                      h2: ({node, ...props}) => <h2 className="text-base font-bold mt-3 mb-2 text-gray-900" {...props} />,
                      h3: ({node, ...props}) => <h3 className="text-sm font-semibold mt-2 mb-1 text-gray-900" {...props} />,
                      p: ({node, ...props}) => <p className="mb-2 text-gray-700" {...props} />,
                      ul: ({node, ...props}) => <ul className="list-disc list-inside mb-2 space-y-1" {...props} />,
                      ol: ({node, ...props}) => <ol className="list-decimal list-inside mb-2 space-y-1" {...props} />,
                      li: ({node, ...props}) => <li className="text-gray-700" {...props} />,
                      strong: ({node, ...props}) => <strong className="font-semibold text-gray-900" {...props} />,
                      em: ({node, ...props}) => <em className="italic" {...props} />,
                      a: ({node, ...props}) => <a className="text-blue-600 hover:text-blue-800 underline" target="_blank" rel="noopener noreferrer" {...props} />,
                      code: ({node, ...props}) => <code className="bg-gray-200 px-1 rounded text-xs" {...props} />,
                      pre: ({node, ...props}) => <pre className="bg-gray-100 p-2 rounded overflow-x-auto text-xs mb-2" {...props} />,
                    }}
                  >
                    {research}
                  </ReactMarkdown>
                </div>
              ) : (
                <p className="text-sm text-gray-500 italic">Gathering research and insights...</p>
              )}
            </div>

            {/* Sources */}
            {sources && sources.length > 0 && (
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-2">
                  <ExternalLink className="w-4 h-4 text-gray-600" />
                  <h4 className="font-medium text-gray-900">Sources</h4>
                </div>
                <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
                  {sources.map((source, index) => (
                    <li key={index}>{source}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Trending Topics */}
            {trendingTopics && trendingTopics.length > 0 && (
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="w-4 h-4 text-gray-600" />
                  <h4 className="font-medium text-gray-900">Trending Topics</h4>
                </div>
                <div className="space-y-2">
                  {trendingTopics.map((topic, index) => (
                    <div key={index} className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <div className="font-medium text-sm text-gray-900">{topic.topic}</div>
                          <div className="text-xs text-gray-600 mt-1">{topic.reason}</div>
                          {topic.url && (
                            <a 
                              href={topic.url} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-xs text-blue-600 hover:text-blue-800 mt-1 flex items-center gap-1"
                            >
                              <ExternalLink className="w-3 h-3" />
                              View source
                            </a>
                          )}
                          {topic.timestamp && (
                            <div className="text-xs text-gray-500 mt-1">
                              {new Date(topic.timestamp).toLocaleDateString()}
                            </div>
                          )}
                        </div>
                        {topic.confidence && (
                          <div className={clsx(
                            "px-2 py-1 rounded text-xs font-medium",
                            topic.confidence === "High" ? "bg-green-100 text-green-800" :
                            topic.confidence === "Medium" ? "bg-yellow-100 text-yellow-800" :
                            "bg-gray-100 text-gray-800"
                          )}>
                            {topic.confidence}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Refinement Input */}
            {refinementMode !== 'none' && (
              <div 
                key={`refinement-${refinementMode}`}
                ref={refinementInputRef} 
                className="mb-6 p-4 bg-yellow-50 rounded-lg border border-yellow-200"
              >
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  {refinementMode === 'refine' ? 'Refinement Request' : 'New Query'}
                </label>
                <textarea
                  value={refinementText}
                  onChange={(e) => setRefinementText(e.target.value)}
                  placeholder={
                    refinementMode === 'refine'
                      ? 'E.g., "Focus on B2B audience" or "Exclude sustainability topics"'
                      : 'Enter your new query...'
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  rows={3}
                  autoFocus
                />
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={refinementMode === 'refine' ? handleRefine : handleRestart}
                    disabled={refinementMode === 'refine' && !refinementText.trim()}
                    className={clsx(
                      'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                      (refinementMode === 'restart' || refinementText.trim())
                        ? 'bg-blue-600 text-white hover:bg-blue-700'
                        : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    )}
                  >
                    Submit
                  </button>
                  <button
                    onClick={() => {
                      setRefinementMode('none')
                      setRefinementText('')
                    }}
                    className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-200 text-gray-700 hover:bg-gray-300"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

      {/* Fixed Action Buttons - Hide when status is complete */}
      {sessionStatus !== 'complete' && (
        <div className="p-4 pt-3 border-t border-blue-200 flex-shrink-0 bg-white rounded-b-lg">
          <div className="flex gap-3">
            <button
              onClick={onApprove}
              disabled={isGenerating || sessionStatus === 'researching'}
              className={clsx(
                'flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-colors text-sm',
                (isGenerating || sessionStatus === 'researching')
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-green-600 text-white hover:bg-green-700'
              )}
            >
              <CheckCircle2 className="w-4 h-4" />
              Approve & Proceed
            </button>
            <button
              onClick={() => setRefinementMode('refine')}
              disabled={isGenerating}
              className={clsx(
                'flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-colors text-sm',
                isGenerating
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-yellow-500 text-white hover:bg-yellow-600'
              )}
            >
              <RefreshCw className="w-4 h-4" />
              Request Refinement
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                console.log('Restart Research button clicked, isGenerating:', isGenerating)
                if (!isGenerating) {
                  // Immediately restart without showing textarea
                  onRestart('')
                } else {
                  console.log('Button is disabled, cannot restart')
                }
              }}
              disabled={isGenerating}
              className={clsx(
                'flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-colors text-sm',
                isGenerating
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-gray-600 text-white hover:bg-gray-700 cursor-pointer'
              )}
            >
              <XCircle className="w-4 h-4" />
              Restart Research
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
