'use client'

import { useQuery } from 'convex/react'
import { useEffect, useMemo } from 'react'
// @ts-ignore - Import from backend package
import { api } from '../../convex-backend/convex/_generated/api'
import { PlatformIdeas } from './PlatformIdeas'
import { Sparkles } from 'lucide-react'

interface SidebarProps {
  sessionId: string
}

export function Sidebar({ sessionId }: SidebarProps) {
  const session = useQuery(api.sessions.getSession, { sessionId })

  const platforms = session?.platforms || []
  const ideas = session?.ideas || {}
  const isGenerating = session?.status === 'generating'
  const updatedAt = session?.updatedAt || 0
  
  // Create a stable key based on ideas and updatedAt to force re-renders when ideas change
  const ideasKey = useMemo(() => {
    const platformCounts = Object.keys(ideas).map(platform => ({
      platform,
      count: ideas[platform]?.length || 0
    }))
    return `${updatedAt}-${JSON.stringify(platformCounts)}`
  }, [ideas, updatedAt])
  
  // Debug: log when ideas or session changes
  useEffect(() => {
    console.log('Sidebar: Session updated, updatedAt:', updatedAt)
    console.log('Sidebar: Current ideas:', Object.keys(ideas).map(p => `${p}: ${ideas[p]?.length || 0} ideas`))
    console.log('Sidebar: Full ideas object:', ideas)
  }, [ideas, updatedAt, session])

  return (
    <div className="w-96 border-l bg-white flex flex-col">
      <div className="border-b px-6 py-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-blue-600" />
          <h2 className="text-lg font-semibold text-gray-900">Generated Ideas</h2>
        </div>
        <p className="text-sm text-gray-600 mt-1">Platform-specific marketing copy</p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {platforms.length === 0 ? (
          <div className="p-6 text-center text-gray-500">
            <p>No platforms selected. Start a query to generate ideas.</p>
          </div>
        ) : (
          <div className="divide-y">
            {platforms.map((platform) => {
              // Get ideas for this platform and clean them
              const platformIdeas = ideas[platform] || []
              
              // Debug logging
              if (platformIdeas.length > 0) {
                console.log(`Sidebar: Platform ${platform} has ${platformIdeas.length} ideas:`, platformIdeas.slice(0, 2))
              }
              
              const cleanedIdeas = platformIdeas
                .map((idea: any) => {
                  if (typeof idea !== 'string') return String(idea)
                  // Remove JSON formatting
                  return idea
                    .replace(/^```json\s*/i, '')
                    .replace(/^```\s*/, '')
                    .replace(/\s*```$/, '')
                    .replace(/^\[\s*/, '')
                    .replace(/\s*\]$/, '')
                    .trim()
                    .replace(/^["',\s]+/, '')
                    .replace(/["',\s]+$/, '')
                    .replace(/\\"/g, '"')
                    .replace(/\\n/g, ' ')
                })
                .filter((idea: string) => {
                  const trimmed = idea.trim()
                  return trimmed.length > 0 && 
                         !trimmed.match(/^[\[\]{}",\s]+$/) &&
                         trimmed !== "```json" &&
                         trimmed !== "```"
                })
              
              return (
                <PlatformIdeas
                  key={`${platform}-${ideasKey}-${cleanedIdeas.length}`}
                  platform={platform}
                  ideas={cleanedIdeas}
                  isGenerating={isGenerating && cleanedIdeas.length === 0}
                />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
