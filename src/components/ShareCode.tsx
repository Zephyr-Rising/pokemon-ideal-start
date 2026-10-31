import { useState } from 'react'

import { cardDataVersion, decodeShare, type SharePayload } from '../lib/share'

/**
 * A button that copies a share code. If the clipboard is not available (an
 * embedded browser, a blocked permission), the code is shown to copy by hand.
 */
export function CopyCode({ label, make }: { label: string; make: () => Promise<string> }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'shown'>('idle')
  const [code, setCode] = useState('')
  const copy = async () => {
    const next = await make()
    setCode(next)
    try {
      await navigator.clipboard.writeText(next)
      setStatus('copied')
      window.setTimeout(() => setStatus('idle'), 2000)
    } catch {
      setStatus('shown')
    }
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => void copy()}
        className="rounded-md border border-slate-300 px-2.5 py-1 text-xs hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
      >
        {status === 'copied' ? 'Copied' : label}
      </button>
      {status === 'shown' && (
        <input
          readOnly
          value={code}
          aria-label="Share code"
          onFocus={(e) => e.target.select()}
          className="w-64 rounded-md border border-slate-300 px-2 py-1 font-mono text-[0.7rem] dark:border-slate-700 dark:bg-slate-950"
        />
      )}
    </span>
  )
}

/** Paste a code to load its setup, or replay its game. */
export function ImportCode({ onImport }: { onImport: (payload: SharePayload) => void }) {
  const [code, setCode] = useState('')
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null)
  const load = async () => {
    try {
      const payload = await decodeShare(code)
      const sameData = payload.db === cardDataVersion()
      onImport(payload)
      setCode('')
      setMessage(
        sameData
          ? null
          : {
              error: false,
              text: 'This code was made with different card data, so the board may not match exactly.',
            },
      )
    } catch (error) {
      setMessage({ error: true, text: error instanceof Error ? error.message : String(error) })
    }
  }
  return (
    <details className="text-xs text-slate-500">
      <summary className="cursor-pointer select-none hover:text-slate-800 dark:hover:text-slate-200">
        Have a shared code?
      </summary>
      <form
        className="mt-2 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void load()
        }}
      >
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="IS1-…"
          aria-label="Shared code"
          className="w-72 max-w-full rounded-md border border-slate-300 px-2 py-1 font-mono dark:border-slate-700 dark:bg-slate-950"
        />
        <button
          type="submit"
          disabled={code.trim() === ''}
          className="rounded-md border border-slate-300 px-2.5 py-1 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          Load
        </button>
      </form>
      {message && (
        <p className={`mt-1.5 ${message.error ? 'text-rose-700 dark:text-rose-400' : 'text-amber-700 dark:text-amber-400'}`}>
          {message.text}
        </p>
      )}
    </details>
  )
}
