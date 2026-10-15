/**
 * Image Analysis page — upload a photo, AI identifies and analyses the dish.
 * Route: /image
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Sparkles } from 'lucide-react'
import { Header } from '@/components/layout/header'
import { ImageDropZone } from '@/components/ui/image-drop-zone'
import { cn } from '@/lib/utils'

export default function ImagePage() {
  const navigate = useNavigate()
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const handleImageSelect = (file: File) => {
    setSelectedFile(file)
    setPreviewUrl(URL.createObjectURL(file))
  }

  const handleClear = () => {
    setSelectedFile(null)
    setPreviewUrl(null)
  }

  const handleAnalyse = () => {
    if (!selectedFile) return
    navigate('/results', {
      state: { query: '', image: selectedFile },
    })
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg)]">
      <Header />
      <main className="mx-auto max-w-screen-2xl px-4 sm:px-6 lg:px-16 py-14">
        <div className="flex gap-12 xl:gap-16 items-start">
          {/* ── Left: upload column ── */}
          <div className="flex-1 min-w-0">
        {/* Page heading */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-10 text-center"
        >
          <p className="text-xs font-semibold uppercase tracking-widest text-[var(--color-accent)] mb-2">
            Image Analysis
          </p>
          <h1 className="text-3xl font-bold text-[var(--color-text)] mb-3">
            Upload a food photo
          </h1>
          <p className="text-sm text-[var(--color-text-muted)] max-w-sm mx-auto leading-relaxed">
            Drop any image of a dish — the AI will identify it and return a full
            nutritional breakdown with ingredients and instructions.
          </p>
        </motion.div>

        {/* Drop zone */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <ImageDropZone
            onImageSelect={handleImageSelect}
            onClear={handleClear}
            previewUrl={previewUrl}
            variant="full"
          />
        </motion.div>

        {/* Analyse button */}
        {selectedFile && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-6 flex justify-center"
          >
            <button
              onClick={handleAnalyse}
              className={cn(
                'inline-flex items-center gap-2 rounded-full px-8 py-3 text-sm font-semibold',
                'bg-[var(--color-accent)] text-[var(--color-accent-contrast)]',
                'hover:opacity-90 transition-opacity shadow-lg shadow-[var(--color-accent)]/20',
              )}
            >
              <Sparkles size={16} />
              Analyse Dish
            </button>
          </motion.div>
        )}

        {/* Helper tips */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.25 }}
          className="mt-10 grid grid-cols-3 gap-4"
        >
          {[
            { label: 'Good lighting', tip: 'Bright, even light gives better results' },
            { label: 'Single dish', tip: 'One food item per photo works best' },
            { label: 'Max 10 MB', tip: 'JPEG · PNG · WebP accepted' },
          ].map(({ label, tip }) => (
            <div
              key={label}
              className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-center"
            >
              <p className="text-xs font-semibold text-[var(--color-text)] mb-0.5">{label}</p>
              <p className="text-[11px] text-[var(--color-text-muted)] leading-snug">{tip}</p>
            </div>
          ))}
        </motion.div>
          </div>{/* end upload column */}

          {/* ── Right: desktop info panel ── */}
          <aside className="hidden xl:flex flex-col gap-5 w-80 flex-shrink-0 pt-16">
            <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-accent)] mb-4">How it works</h3>
              <ol className="space-y-4">
                {[
                  { step: '01', text: 'Upload a photo of any Indian dish' },
                  { step: '02', text: 'ConvNeXt model identifies the dish from 239 classes' },
                  { step: '03', text: 'Full nutritional profile retrieved from the knowledge graph' },
                  { step: '04', text: 'LLM provides analysis and ingredient breakdown' },
                ].map(({ step, text }) => (
                  <li key={step} className="flex gap-3 text-sm">
                    <span className="font-bold text-[var(--color-accent)] flex-shrink-0">{step}</span>
                    <span className="text-[var(--color-text-muted)] leading-relaxed">{text}</span>
                  </li>
                ))}
              </ol>
            </div>

            <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)] mb-3">Accepted formats</h3>
              <div className="flex flex-wrap gap-2">
                {['JPEG', 'PNG', 'WebP', 'GIF', 'BMP'].map((fmt) => (
                  <span key={fmt} className="rounded-full border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1 text-xs font-medium text-[var(--color-text-muted)]">{fmt}</span>
                ))}
              </div>
              <p className="mt-3 text-xs text-[var(--color-text-muted)] leading-relaxed">Max file size: 10 MB</p>
            </div>
          </aside>
        </div>{/* end flex row */}
      </main>
    </div>
  )
}
