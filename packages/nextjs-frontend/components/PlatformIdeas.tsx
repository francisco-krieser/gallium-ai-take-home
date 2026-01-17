'use client'

import { CheckCircle2, Loader2 } from 'lucide-react'
import clsx from 'clsx'

interface PlatformIdeasProps {
  platform: string
  ideas: string[]
  isGenerating: boolean
}

export function PlatformIdeas({ platform, ideas, isGenerating }: PlatformIdeasProps) {
  const getPlatformColor = (platform: string) => {
    const colors: Record<string, string> = {
      LinkedIn: 'bg-blue-50 border-blue-200 text-blue-900',
      X: 'bg-black border-gray-800 text-white',
      Instagram: 'bg-gradient-to-br from-purple-500 to-pink-500 border-purple-300 text-white',
      Facebook: 'bg-blue-600 border-blue-500 text-white',
      TikTok: 'bg-black border-gray-800 text-white',
    }
    return colors[platform] || 'bg-gray-50 border-gray-200 text-gray-900'
  }

  return (
    <div className="p-6">
      <div className={clsx(
        'inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium border',
        getPlatformColor(platform)
      )}>
        {platform}
        {isGenerating && ideas.length === 0 && (
          <Loader2 className="w-4 h-4 animate-spin" />
        )}
        {ideas.length > 0 && (
          <CheckCircle2 className="w-4 h-4" />
        )}
      </div>

      <div className="mt-4 space-y-3">
        {ideas.length === 0 ? (
          <div className="text-sm text-gray-500 italic">
            {isGenerating ? 'Generating ideas...' : 'No ideas generated yet'}
          </div>
        ) : (
          ideas.map((idea, index) => {
            // Clean up idea text - remove JSON markers and extra formatting
            let cleanIdea = idea
            if (typeof idea === 'string') {
              // Remove JSON code block markers
              cleanIdea = idea.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '')
              // Remove JSON array brackets if present
              cleanIdea = cleanIdea.replace(/^\[\s*/, '').replace(/\s*\]$/, '')
              // Remove quotes and commas at start/end
              cleanIdea = cleanIdea.trim().replace(/^["',\s]+/, '').replace(/["',\s]+$/, '')
              // Remove escaped quotes
              cleanIdea = cleanIdea.replace(/\\"/g, '"').replace(/\\n/g, ' ')
            }
            
            return (
              <div
                key={index}
                className="p-3 bg-gray-50 rounded-lg border border-gray-200 text-sm text-gray-700 whitespace-pre-wrap"
              >
                {cleanIdea}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
