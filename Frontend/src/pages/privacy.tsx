import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft } from 'lucide-react'
import { Logo } from '@/components/ui/logo'

const LAST_UPDATED = 'April 30, 2026'

const sections = [
  {
    title: '1. Information We Collect',
    body: `We collect the following information when you use NutriVerse:

• **Account data** — your name, email address, and authentication credentials when you register or sign in with Google.
• **Food & nutrition queries** — text searches, food names, and nutritional questions you submit to get analysis results.
• **Images** — photographs you upload for food recognition. Images are sent to our servers solely for AI analysis and are not stored permanently.
• **Interaction data** — which dishes or products you like, dislike, rate, or mark as cooked. Used to personalise recommendations.
• **Usage preferences** — dietary goals, health tags, cuisine preferences, and other settings you configure within the app.
• **AI response feedback** — if you submit feedback on an AI-generated response, we store the response text and your comment. Used to monitor and improve response quality.
• **Issue reports** — if you flag a problem with a result, we store your description and the query context to investigate accuracy issues.
• **Device metadata** — operating system type and app version, used for diagnostics only.

We do not collect your location, contacts, payment information, or any biometric data.`,
  },
  {
    title: '2. AI-Generated Content',
    body: `NutriVerse uses large language models (Groq) and computer vision models (ConvNeXt) to generate nutrition analysis, recipe suggestions, and cooking guidance. All AI-generated responses are clearly labelled within the app.

This content is for informational purposes only and is **not a substitute for advice from a qualified nutritionist, dietitian, or medical professional**. AI responses may occasionally contain errors — always verify nutritional information before making health or dietary decisions.

Queries sent to Groq for LLM inference are governed by Groq's data processing agreement. Groq does not use your queries to train its models.`,
  },
  {
    title: '3. How We Use Your Information',
    body: `Your data is used exclusively to operate and improve NutriVerse:

• Authenticating your account and keeping it secure
• Delivering personalised nutrition analysis, meal recommendations, and food comparisons
• Powering the AI Chef with contextual, step-by-step cooking guidance
• Improving AI model accuracy and search relevance using aggregated, anonymised patterns
• Reviewing AI response feedback and issue reports to identify and fix inaccuracies
• Sending transactional emails (e.g. password reset) — never marketing emails without consent

We do not sell, rent, or share your personal data with third-party advertisers.`,
  },
  {
    title: '4. Third-Party Services',
    body: `NutriVerse uses the following third-party services to function:

• **Firebase (Google)** — account authentication and session management. Governed by Google's Privacy Policy.
• **Microsoft Azure** — our backend API and compute infrastructure. Data is processed in Azure data centres (Southeast Asia region).
• **Neo4j Aura** — our graph database for storing nutritional knowledge and interaction history. Hosted on managed cloud infrastructure.
• **Groq** — large language model inference for AI-generated nutrition responses and cooking guidance. Queries are not used to train Groq's models.

All third-party providers are contractually bound to protect your data and may not use it for their own commercial purposes.`,
  },
  {
    title: '5. Data Retention',
    body: `• **Account data** — retained while your account is active. Deleted within 30 days of account deletion.
• **Food images** — processed in-memory on our servers and not stored permanently.
• **AI feedback & issue reports** — retained for up to 12 months for quality monitoring, then deleted.
• **Anonymised aggregates** — derived from usage patterns with no personally identifying information; may be retained indefinitely for product improvement.`,
  },
  {
    title: '6. Data Security',
    body: `We use industry-standard security measures including HTTPS/TLS encryption for all data in transit, Firebase Authentication for secure credential management, and access controls that restrict employee access to production data. Sensitive admin endpoints are protected by secret tokens and are not publicly accessible.

No method of transmission over the internet is 100% secure; we take all reasonable precautions but cannot guarantee absolute security.`,
  },
  {
    title: '7. Your Rights',
    body: `You have the right to:

• **Access** — request a copy of the personal data we hold about you
• **Correction** — ask us to update inaccurate data
• **Deletion** — request deletion of your account and all associated data
• **Portability** — receive your data in a machine-readable format
• **Withdraw consent** — stop using the service at any time; signing out immediately removes locally stored session data

To exercise any of these rights, contact us at the email below. We will respond within 30 days.`,
  },
  {
    title: "8. Children's Privacy",
    body: `NutriVerse is not directed at children under 13. We do not knowingly collect personal information from children. If you believe a child has provided us with personal data, please contact us and we will delete it promptly.`,
  },
  {
    title: '9. Changes to This Policy',
    body: `We may update this Privacy Policy as the app evolves. When we do, we will update the "Last updated" date at the top of this page. Continued use of NutriVerse after changes constitutes acceptance of the revised policy.`,
  },
  {
    title: '10. Contact',
    body: `If you have questions, concerns, or data deletion requests, contact us at:\n\nkashyapk1305@gmail.com`,
  },
]

function formatBody(text: string) {
  return text.split('\n').map((line, i) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/)
    return (
      <span key={i}>
        {parts.map((part, j) =>
          part.startsWith('**') && part.endsWith('**')
            ? <strong key={j} className="text-white/80 font-semibold">{part.slice(2, -2)}</strong>
            : <span key={j}>{part}</span>
        )}
        {i < text.split('\n').length - 1 && <br />}
      </span>
    )
  })
}

export default function PrivacyPage() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-white/[0.06] bg-[#0A0A0A]/90 backdrop-blur-md">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center gap-4">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-1.5 text-white/40 hover:text-white/80 transition-colors text-sm font-sans"
          >
            <ArrowLeft size={15} strokeWidth={1.75} />
            Back
          </button>
          <div className="flex-1" />
          <Logo size="sm" alwaysWhite />
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-16">
        {/* Title */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="mb-14"
        >
          <p className="text-[10px] font-sans font-semibold uppercase tracking-[0.45em] text-white/25 mb-4">
            Legal
          </p>
          <h1 className="font-serif text-5xl font-bold leading-tight tracking-tight">
            Privacy <span className="font-light italic">Policy</span>
          </h1>
          <p className="mt-4 text-sm text-white/35 font-sans">
            Last updated: {LAST_UPDATED}
          </p>
          <p className="mt-5 text-[13px] text-white/45 font-sans leading-relaxed max-w-xl">
            NutriVerse (&ldquo;we&rdquo;, &ldquo;our&rdquo;, &ldquo;us&rdquo;) is committed to protecting your privacy.
            This policy explains what data we collect, how we use it, and your rights regarding that data.
            It applies to the NutriVerse desktop app, web app, and Chrome extension.
          </p>
        </motion.div>

        {/* Sections */}
        <div className="space-y-10">
          {sections.map((section, idx) => (
            <motion.div
              key={section.title}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.05 * idx, ease: [0.22, 1, 0.36, 1] }}
              className="border-t border-white/[0.07] pt-10"
            >
              <h2 className="font-serif text-xl font-semibold text-white/90 mb-4">
                {section.title}
              </h2>
              <p className="text-[13px] text-white/45 font-sans leading-[1.85] whitespace-pre-line">
                {formatBody(section.body)}
              </p>
            </motion.div>
          ))}
        </div>

        {/* Footer note */}
        <div className="mt-16 pt-8 border-t border-white/[0.07]">
          <p className="text-[11px] text-white/15 font-sans">
            &copy; 2026 Kashyap K &mdash; NutriVerse &mdash; For informational purposes only. Not intended as medical or dietary advice.
          </p>
        </div>
      </div>
    </div>
  )
}
