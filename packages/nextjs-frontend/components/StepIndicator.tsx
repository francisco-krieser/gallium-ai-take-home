'use client'

import { CheckCircle2, Circle, Loader2 } from 'lucide-react'
import clsx from 'clsx'

interface StepIndicatorProps {
  status: 'researching' | 'waiting_approval' | 'generating' | 'complete'
}

const steps = [
  { id: 'researching', label: 'Researching' },
  { id: 'waiting_approval', label: 'Awaiting Approval' },
  { id: 'generating', label: 'Generating Ideas' },
  { id: 'complete', label: 'Complete' },
]

export function StepIndicator({ status }: StepIndicatorProps) {
  const getStepIndex = (status: string) => {
    return steps.findIndex(s => s.id === status)
  }

  const currentIndex = getStepIndex(status)

  return (
    <div className="flex items-center gap-4">
      {steps.map((step, index) => {
        const isComplete = status === 'complete' ? true : index < currentIndex
        const isActive = status === 'complete' ? false : index === currentIndex
        const isPending = status === 'complete' ? false : index > currentIndex

        return (
          <div key={step.id} className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              {isComplete ? (
                <CheckCircle2 className="w-5 h-5 text-green-600" />
              ) : isActive ? (
                <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
              ) : (
                <Circle className="w-5 h-5 text-gray-400" />
              )}
              <span
                className={clsx(
                  'text-sm font-medium',
                  isActive && 'text-blue-600',
                  isComplete && 'text-green-600',
                  isPending && 'text-gray-400'
                )}
              >
                {step.label}
              </span>
            </div>
            {index < steps.length - 1 && (
              <div
                className={clsx(
                  'w-12 h-0.5',
                  isComplete ? 'bg-green-600' : 'bg-gray-300'
                )}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
