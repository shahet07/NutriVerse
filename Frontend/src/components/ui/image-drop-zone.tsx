/**
 * ImageDropZone — drag-and-drop image upload component.
 * Accepts files via drag, click, or paste.
 * Emits the selected File to the parent via onImageSelect.
 */
import { useState, useRef, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Camera, Upload, X, ImageIcon, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ImageDropZoneProps {
  onImageSelect: (file: File) => void
  onClear?: () => void
  /** If provided, shows this preview instead of re-reading the file */
  previewUrl?: string | null
  className?: string
  /** compact = small inline zone; full = large centered drop area */
  variant?: 'compact' | 'full'
}

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

export function ImageDropZone({
  onImageSelect,
  onClear,
  previewUrl,
  className,
  variant = 'full',
}: ImageDropZoneProps) {
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const [localPreview, setLocalPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragCounter = useRef(0)

  // Use prop preview if available, else local
  const displayPreview = previewUrl ?? localPreview

  const handleFile = useCallback(
    (file: File) => {
      if (!ACCEPTED.includes(file.type)) {
        setError('Please upload a JPEG, PNG, or WebP image.')
        return
      }
      if (file.size > 10 * 1024 * 1024) {
        setError('Image must be under 10 MB.')
        return
      }
      setError(null)
      setProcessing(true)

      // Generate local preview
      const url = URL.createObjectURL(file)
      setLocalPreview(url)

      setTimeout(() => {
        setProcessing(false)
        onImageSelect(file)
      }, 200)
    },
    [onImageSelect],
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      dragCounter.current = 0
      setIsDraggingOver(false)
      const file = e.dataTransfer.files[0]
      if (file) handleFile(file)
    },
    [handleFile],
  )

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current += 1
    setIsDraggingOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current -= 1
    if (dragCounter.current === 0) setIsDraggingOver(false)
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  const handleClear = () => {
    if (localPreview) {
      URL.revokeObjectURL(localPreview)
      setLocalPreview(null)
    }
    setError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    onClear?.()
  }

  // Paste support
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) handleFile(file)
          break
        }
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [handleFile])

  // Cleanup preview URL on unmount
  useEffect(() => {
    return () => {
      if (localPreview) URL.revokeObjectURL(localPreview)
    }
  }, [localPreview])

  if (variant === 'compact') {
    return (
      <div className={cn('relative', className)}>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED.join(',')}
          onChange={handleInputChange}
          className="hidden"
        />
        {displayPreview ? (
          <div className="relative h-10 w-10 rounded-xl overflow-hidden border border-[var(--color-border)]">
            <img src={displayPreview} alt="Upload preview" className="h-full w-full object-cover" />
            <button
              type="button"
              onClick={handleClear}
              className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 hover:opacity-100 transition-opacity"
            >
              <X size={12} className="text-white" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)]/50 transition-colors"
            aria-label="Upload food image"
          >
            <Camera size={17} strokeWidth={1.5} />
          </button>
        )}
      </div>
    )
  }

  /* ── Full variant ─────────────────────────────────────────────── */
  return (
    <div className={cn('w-full', className)}>
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED.join(',')}
        onChange={handleInputChange}
        className="hidden"
      />

      <AnimatePresence mode="wait">
        {displayPreview ? (
          /* Preview state */
          <motion.div
            key="preview"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            className="relative rounded-2xl overflow-hidden border border-[var(--color-border)]"
          >
            <img
              src={displayPreview}
              alt="Food image preview"
              className="w-full max-h-64 object-cover"
            />

            {/* Processing overlay */}
            {processing && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                <Loader2 size={24} className="text-white animate-spin" />
              </div>
            )}

            {/* Clear button */}
            <button
              type="button"
              onClick={handleClear}
              className="absolute top-3 right-3 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
            >
              <X size={13} />
            </button>

            <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent px-4 py-3">
              <p className="text-xs font-medium text-white/80">Image ready for analysis</p>
            </div>
          </motion.div>
        ) : (
          /* Drop zone */
          <motion.div
            key="dropzone"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onDrop={handleDrop}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              'flex flex-col items-center justify-center gap-4',
              'rounded-2xl border-2 border-dashed px-6 py-12',
              'cursor-pointer transition-all duration-200',
              isDraggingOver
                ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/5 scale-[1.01]'
                : 'border-[var(--color-border)] hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-bg)]',
            )}
          >
            <motion.div
              animate={{ scale: isDraggingOver ? 1.15 : 1 }}
              transition={{ type: 'spring', stiffness: 400, damping: 20 }}
              className={cn(
                'flex h-14 w-14 items-center justify-center rounded-2xl border transition-colors duration-200',
                isDraggingOver
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                  : 'border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text-muted)]',
              )}
            >
              {isDraggingOver ? <ImageIcon size={24} /> : <Upload size={22} strokeWidth={1.5} />}
            </motion.div>

            <div className="text-center">
              <p className="text-sm font-medium text-[var(--color-text)]">
                {isDraggingOver ? 'Drop to upload' : 'Drag & drop a food photo'}
              </p>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                or click to browse · paste from clipboard · JPEG, PNG, WebP up to 10 MB
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error message */}
      <AnimatePresence>
        {error && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-2 text-xs text-red-500"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  )
}
