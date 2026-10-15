import { motion } from 'framer-motion'
import { Logo } from '@/components/ui/logo'

const PARTICLES = Array.from({ length: 18 }, (_, i) => ({
  id: i,
  x: Math.round(5 + (i * 5.5) % 90),
  y: Math.round(8 + (i * 7.3) % 84),
  size: i % 3 === 0 ? 1.5 : 1,
  delay: (i * 0.19) % 2.4,
  duration: 2.6 + (i % 4) * 0.55,
}))

export default function LoadingScreen() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#080808] overflow-hidden"
    >
      {/* Ambient particles */}
      <div className="absolute inset-0 pointer-events-none">
        {PARTICLES.map((p) => (
          <motion.div
            key={p.id}
            className="absolute rounded-full bg-white"
            style={{
              left: `${p.x}%`,
              top: `${p.y}%`,
              width: p.size,
              height: p.size,
            }}
            animate={{ opacity: [0, 0.35, 0], scale: [0.6, 1.4, 0.6] }}
            transition={{
              duration: p.duration,
              repeat: Infinity,
              delay: p.delay,
              ease: 'easeInOut',
            }}
          />
        ))}
      </div>

      {/* Soft radial glow behind logo */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 480,
          height: 480,
          background: 'radial-gradient(circle, rgba(255,255,255,0.03) 0%, transparent 70%)',
        }}
        animate={{ scale: [1, 1.12, 1], opacity: [0.6, 1, 0.6] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Centre stack */}
      <div className="relative flex flex-col items-center gap-12">

        {/* Logo with breathing glow */}
        <div className="relative">
          <motion.div
            className="absolute inset-0 -m-8 rounded-3xl blur-2xl"
            style={{ background: 'radial-gradient(ellipse, rgba(255,255,255,0.06) 0%, transparent 65%)' }}
            animate={{ opacity: [0.4, 0.9, 0.4], scale: [0.9, 1.05, 0.9] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div
            animate={{ opacity: [0.75, 1, 0.75] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          >
            <Logo size="lg" alwaysWhite />
          </motion.div>
        </div>

        {/* Waveform bar animation */}
        <div className="flex items-end gap-[5px] h-6">
          {[0.5, 0.75, 1, 0.85, 0.6, 0.9, 0.65, 0.8, 0.5].map((h, i) => (
            <motion.div
              key={i}
              className="w-[3px] rounded-full bg-white/30"
              animate={{ scaleY: [h * 0.4, h, h * 0.4] }}
              transition={{
                duration: 1.1,
                repeat: Infinity,
                delay: i * 0.09,
                ease: 'easeInOut',
              }}
              style={{ height: 24, transformOrigin: 'bottom' }}
            />
          ))}
        </div>

        {/* Text */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.7 }}
          className="flex flex-col items-center gap-2"
        >
          <p className="text-[13px] text-white/30 font-sans tracking-[0.12em]">
            Preparing your nutrition experience
          </p>
          <div className="flex gap-1.5">
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                className="h-[3px] w-[3px] rounded-full bg-white/25"
                animate={{ opacity: [0.15, 0.8, 0.15] }}
                transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.22, ease: 'easeInOut' }}
              />
            ))}
          </div>
        </motion.div>
      </div>

      {/* Bottom disclaimer */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6, duration: 0.8 }}
        className="absolute bottom-8 text-sm text-white/20 font-sans text-center tracking-wide px-8"
      >
        For educational purposes only. Not intended as medical advice.
      </motion.p>
    </motion.div>
  )
}
