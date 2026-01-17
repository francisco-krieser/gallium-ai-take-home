'use client'

import { useQuery } from 'convex/react'
import { useEffect, useMemo } from 'react'
// @ts-ignore - Import from backend package
import { api } from '../../convex-backend/convex/_generated/api'
import { PlatformIdeas } from './PlatformIdeas'
import { Sparkles, Download } from 'lucide-react'

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

  const exportToMarkdown = () => {
    if (!session) return

    const research = session.research || ''
    const ideasData = session.ideas || {}
    const query = session.query || 'Untitled Query'
    const persona = session.persona || 'author'
    const platforms = session.platforms || []

    // Clean ideas similar to how they're displayed
    const cleanIdea = (idea: any): string => {
      if (typeof idea !== 'string') return String(idea)
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
        .replace(/\\n/g, '\n')
    }

    // Build markdown content
    let markdown = `# Marketing Copy Generation Report\n\n`
    markdown += `**Query:** ${query}\n\n`
    markdown += `**Persona:** ${persona.charAt(0).toUpperCase() + persona.slice(1)}\n\n`
    markdown += `**Platforms:** ${platforms.join(', ')}\n\n`
    markdown += `**Generated:** ${new Date(updatedAt).toLocaleString()}\n\n`
    markdown += `---\n\n`

    // Add research summary
    if (research) {
      markdown += `## Research Summary\n\n`
      markdown += `${research}\n\n`
      markdown += `---\n\n`
    }

    // Add sources if available
    if (session.sources && session.sources.length > 0) {
      markdown += `## Sources\n\n`
      session.sources.forEach((source, index) => {
        markdown += `${index + 1}. ${source}\n`
      })
      markdown += `\n---\n\n`
    }

    // Add trending topics if available
    if (session.trendingTopics && session.trendingTopics.length > 0) {
      markdown += `## Trending Topics\n\n`
      session.trendingTopics.forEach((topic, index) => {
        markdown += `### ${index + 1}. ${topic.topic}\n\n`
        markdown += `${topic.reason}\n\n`
        if (topic.url) {
          markdown += `[Source](${topic.url})\n\n`
        }
      })
      markdown += `---\n\n`
    }

    // Add generated ideas by platform
    markdown += `## Generated Ideas\n\n`
    
    if (Object.keys(ideasData).length === 0) {
      markdown += `No ideas generated yet.\n\n`
    } else {
      platforms.forEach((platform) => {
        const platformIdeas = ideasData[platform] || []
        const cleanedIdeas = platformIdeas
          .map(cleanIdea)
          .filter((idea: string) => {
            const trimmed = idea.trim()
            return trimmed.length > 0 && 
                   !trimmed.match(/^[\[\]{}",\s]+$/) &&
                   trimmed !== "```json" &&
                   trimmed !== "```"
          })

        if (cleanedIdeas.length > 0) {
          markdown += `### ${platform}\n\n`
          cleanedIdeas.forEach((idea: string, index: number) => {
            markdown += `${index + 1}. ${idea}\n\n`
          })
        }
      })
    }

    // Create blob and download
    const blob = new Blob([markdown], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `marketing-copy-${query.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${Date.now()}.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const canExport = session && (session.research || Object.keys(ideas).length > 0)

  return (
    <div className="w-96 border-l bg-white flex flex-col">
      <div className="border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-semibold text-gray-900">Generated Ideas</h2>
          </div>
          {canExport && (
            <button
              onClick={exportToMarkdown}
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors"
              title="Export to Markdown"
            >
              <Download className="w-4 h-4" />
              Export
            </button>
          )}
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
