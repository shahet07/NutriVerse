"use client"

import type React from "react"
import { useState, useRef, useEffect } from "react"
import { Search, Camera, ArrowRight, X } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { cn } from "@/lib/utils"

const SUGGESTIONS = [
  "High protein breakfast",
  "Compare Biryani vs Pulao",
  "Keto-friendly snacks",
  "Paneer Tikka",
  "Diabetic friendly desserts",
  "Low calorie Dal",
  "Sambar nutrition facts",
  "Vegan Indian meals",
]

interface SearchBarProps {
  placeholder?: string
  onSearch?: (query: string, image?: File) => void
  compact?: boolean
  defaultValue?: string
  autoFocus?: boolean
  glass?: boolean
}

const SearchBar = ({
  placeholder = "Search any dish, compare, or modify...",
  onSearch,
  compact = false,
  defaultValue = "",
  autoFocus = false,
  glass = false,
}: SearchBarProps) => {
  const inputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isFocused, setIsFocused] = useState(false)
  const [searchQuery, setSearchQuery] = useState(defaultValue)
  const [isAnimating, setIsAnimating] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [selectedImage, setSelectedImage] = useState<File | null>(null)
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null)

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setSearchQuery(value)

    if (value.trim()) {
      const filtered = SUGGESTIONS.filter((item) =>
        item.toLowerCase().includes(value.toLowerCase()),
      )
      setSuggestions(filtered)
    } else {
      setSuggestions([])
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (onSearch && (searchQuery.trim() || selectedImage)) {
      onSearch(searchQuery, selectedImage ?? undefined)
      setIsAnimating(true)
      setSuggestions([])
      setTimeout(() => setIsAnimating(false), 600)
    }
  }

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setSelectedImage(file)
      setImagePreviewUrl(URL.createObjectURL(file))
    }
  }

  const removeImage = () => {
    setSelectedImage(null)
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl)
    setImagePreviewUrl(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const selectSuggestion = (suggestion: string) => {
    setSearchQuery(suggestion)
    setSuggestions([])
    if (onSearch) onSearch(suggestion)
  }

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus()
    }
  }, [autoFocus])

  const searchIconVariants = {
    initial: { scale: 1, rotate: 0 },
    animate: {
      rotate: isAnimating ? [0, -10, 10, -5, 5, 0] : 0,
      scale: isAnimating ? [1, 1.15, 1] : 1,
      transition: { duration: 0.5, ease: "easeInOut" },
    },
  }

  const suggestionVariants = {
    hidden: (i: number) => ({
      opacity: 0,
      y: -8,
      transition: { duration: 0.1, delay: i * 0.03 },
    }),
    visible: (i: number) => ({
      opacity: 1,
      y: 0,
      transition: { type: "spring", stiffness: 400, damping: 20, delay: i * 0.05 },
    }),
    exit: (i: number) => ({
      opacity: 0,
      y: -4,
      transition: { duration: 0.08, delay: i * 0.02 },
    }),
  }

  return (
    <div className="relative w-full">
      <motion.form
        onSubmit={handleSubmit}
        className="relative flex items-center justify-center w-full mx-auto"
        initial={false}
        animate={{ scale: isFocused && !compact ? 1.02 : 1 }}
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
      >
        <motion.div
          className={cn(
            "flex items-center w-full rounded-full border relative overflow-hidden",
            "transition-all duration-300",
            glass
              ? isFocused
                ? "bg-white/20 backdrop-blur-xl border-white/50 shadow-[0_0_0_1px_rgba(255,255,255,0.3)]"
                : "bg-white/12 backdrop-blur-xl border-white/25 hover:bg-white/18"
              : isFocused
                ? "bg-[var(--color-surface)] border-[var(--color-accent)] shadow-[0_0_0_1px_var(--color-accent)]"
                : "bg-[var(--color-surface)] border-[var(--color-border)]",
            compact ? "h-11" : "h-14",
          )}
        >
          {/* Search icon */}
          <motion.div
            className={cn("flex-shrink-0", compact ? "pl-3.5" : "pl-5")}
            variants={searchIconVariants}
            initial="initial"
            animate="animate"
          >
            <Search
              size={compact ? 16 : 20}
              strokeWidth={isFocused ? 2.5 : 1.5}
              className={cn(
                "transition-all duration-300",
                glass
                  ? isFocused ? "text-white" : "text-white/60"
                  : isFocused ? "text-[var(--color-accent)]" : "text-[var(--color-text-muted)]",
              )}
            />
          </motion.div>

          {/* Input */}
          <input
            ref={inputRef}
            type="text"
            placeholder={placeholder}
            value={searchQuery}
            onChange={handleSearch}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setTimeout(() => setIsFocused(false), 200)}
            className={cn(
              "w-full bg-transparent outline-none font-sans",
              glass
                ? "placeholder:text-white/45 text-white"
                : "placeholder:text-[var(--color-text-muted)] text-[var(--color-text)]",
              compact
                ? "px-2.5 text-sm"
                : "px-3 text-base",
            )}
          />

          {/* Image preview chip */}
          <AnimatePresence>
            {imagePreviewUrl && (
              <motion.div
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                className="flex items-center gap-1.5 mr-1 flex-shrink-0"
              >
                <div className="relative h-8 w-8 rounded-md overflow-hidden border border-[var(--color-border)]">
                  <img
                    src={imagePreviewUrl}
                    alt="Upload preview"
                    className="h-full w-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={removeImage}
                    className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 hover:opacity-100 transition-opacity"
                  >
                    <X size={12} className="text-white" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Camera button */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageSelect}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "flex-shrink-0 flex items-center justify-center transition-colors",
              glass
                ? "text-white/55 hover:text-white"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-accent)]",
              compact ? "h-8 w-8 mr-1" : "h-10 w-10 mr-1",
            )}
            aria-label="Upload image"
          >
            <Camera size={compact ? 16 : 18} strokeWidth={1.5} />
          </button>

          {/* Submit button — always visible in compact, conditional in full */}
          {compact ? (
            <button
              type="submit"
              className={cn(
                "flex items-center justify-center flex-shrink-0 rounded-full",
                "bg-[var(--color-accent)] text-[var(--color-accent-contrast)]",
                "transition-all hover:shadow-lg hover:opacity-90",
                "h-9 w-9 mr-1.5",
              )}
            >
              <Search size={16} strokeWidth={2} />
            </button>
          ) : (
            <AnimatePresence>
              {(searchQuery || selectedImage) && (
                <motion.button
                  type="submit"
                  initial={{ opacity: 0, scale: 0.8, width: 0 }}
                  animate={{ opacity: 1, scale: 1, width: 'auto' }}
                  exit={{ opacity: 0, scale: 0.8, width: 0 }}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className={cn(
                    "flex items-center justify-center flex-shrink-0 rounded-full",
                    glass
                      ? "bg-white text-black"
                      : "bg-[var(--color-accent)] text-[var(--color-accent-contrast)]",
                    "transition-shadow hover:shadow-lg",
                    "h-10 w-10 mr-2",
                  )}
                >
                  <ArrowRight size={18} strokeWidth={2} />
                </motion.button>
              )}
            </AnimatePresence>
          )}
        </motion.div>
      </motion.form>

      {/* Suggestion dropdown */}
      <AnimatePresence>
        {isFocused && suggestions.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.15 }}
            className={cn(
              "absolute z-50 w-full mt-2 overflow-hidden rounded-2xl",
              glass
                ? "bg-black/60 backdrop-blur-xl border border-white/15 shadow-2xl"
                : "bg-[var(--color-surface)] border border-[var(--color-border)] shadow-lg",
            )}
            style={{ maxHeight: '280px', overflowY: 'auto' }}
          >
            <div className="p-1.5">
              {suggestions.map((suggestion, index) => (
                <motion.div
                  key={suggestion}
                  custom={index}
                  variants={suggestionVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  onClick={() => selectSuggestion(suggestion)}
                  className={cn(
                    "flex items-center gap-3 px-4 py-2.5 cursor-pointer rounded-xl group transition-colors",
                    glass
                      ? "hover:bg-white/10"
                      : "hover:bg-[var(--color-bg)]",
                  )}
                >
                  <Search
                    size={14}
                    className={cn(
                      "flex-shrink-0",
                      glass ? "text-white/40 group-hover:text-white/80" : "text-[var(--color-text-muted)] group-hover:text-[var(--color-accent)]",
                    )}
                  />
                  <span className={cn(
                    "text-sm transition-colors",
                    glass ? "text-white/70 group-hover:text-white" : "text-[var(--color-text)] group-hover:text-[var(--color-accent)]",
                  )}>
                    {suggestion}
                  </span>
                  <ArrowRight
                    size={12}
                    className={cn(
                      "ml-auto opacity-0 group-hover:opacity-100 transition-opacity",
                      glass ? "text-white/60" : "text-[var(--color-text-muted)]",
                    )}
                  />
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export { SearchBar }
