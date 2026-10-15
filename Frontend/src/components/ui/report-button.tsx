import { useState } from 'react'
import { Flag, X, Send, Check } from 'lucide-react'
import { reportIssue } from '@/lib/api'
import { cn } from '@/lib/utils'

interface ReportButtonProps {
  query?: string
  responseType?: string
  aiResponse?: string
  dark?: boolean
}

export function ReportButton({ query, responseType, aiResponse, dark }: ReportButtonProps) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!text.trim()) return
    setStatus('sending')
    try {
      await reportIssue({ description: text.trim(), query, response_type: responseType })
      setStatus('done')
      setTimeout(() => { setOpen(false); setText(''); setStatus('idle') }, 1800)
    } catch {
      setStatus('error')
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={cn(
          'inline-flex items-center gap-1.5 text-[11px] font-medium transition-colors duration-150',
          dark
            ? 'text-white/30 hover:text-white/60'
            : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
        )}
        title="Report an issue or leave feedback on this response"
      >
        <Flag size={11} strokeWidth={1.75} />
        Report issue
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false) }}
        >
          <div className="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Flag size={15} strokeWidth={1.75} className="text-[var(--color-text-muted)]" />
                <h3 className="text-sm font-semibold text-[var(--color-text)]">Report issue / Feedback</h3>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
              >
                <X size={16} strokeWidth={1.75} />
              </button>
            </div>

            {aiResponse && (
              <div className="mb-4 px-3 py-2 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)]">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
                  AI Response
                </p>
                <p className="text-[11px] text-[var(--color-text-muted)] leading-relaxed line-clamp-3">
                  {aiResponse.slice(0, 400)}{aiResponse.length > 400 && '…'}
                </p>
              </div>
            )}

            {!aiResponse && query && (
              <p className="text-[11px] text-[var(--color-text-muted)] mb-4 px-3 py-2 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] leading-relaxed line-clamp-2">
                <span className="font-semibold">Query:</span> {query}
              </p>
            )}

            <form onSubmit={handleSubmit} className="space-y-3">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Was this response helpful? Inaccurate? Off the mark? Describe any issue or share your thoughts…"
                rows={4}
                maxLength={2000}
                className={cn(
                  'w-full resize-none rounded-xl border border-[var(--color-border)]',
                  'bg-[var(--color-bg)] px-4 py-3 text-sm text-[var(--color-text)]',
                  'placeholder:text-[var(--color-text-muted)] outline-none',
                  'focus:border-[var(--color-accent)]/50 transition-colors duration-150',
                )}
              />
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-[var(--color-text-muted)]">
                  {text.length}/2000
                </span>
                <button
                  type="submit"
                  disabled={!text.trim() || status === 'sending' || status === 'done'}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-medium',
                    'transition-all duration-150',
                    status === 'done'
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/20'
                      : 'bg-[var(--color-accent)] text-[var(--color-accent-contrast)] hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed',
                  )}
                >
                  {status === 'done' ? (
                    <><Check size={11} strokeWidth={2} /> Submitted</>
                  ) : status === 'sending' ? (
                    <span className="h-3 w-3 border border-current border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <><Send size={11} strokeWidth={1.75} /> Submit</>
                  )}
                </button>
              </div>
              {status === 'error' && (
                <p className="text-[11px] text-red-400">Failed to submit — please try again.</p>
              )}
            </form>
          </div>
        </div>
      )}
    </>
  )
}
