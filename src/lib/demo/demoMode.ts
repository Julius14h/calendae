// `?demo` in the URL (e.g. calendae.vercel.app/?demo) opens a pre-filled
// schedule generated from the bundled mock CSVs — every name/email in them
// is fabricated (@test.calendae.dev), so it's safe to show anyone. Demo
// mode never reads or writes the real stored schedule (see
// scheduleStorage.ts), so a visitor's edits can't clobber a real save, and
// every reload starts the demo fresh.
export const IS_DEMO_MODE = new URLSearchParams(window.location.search).has('demo')

/** Dynamically imported so the ~140KB of mock CSV text only ships to visitors who actually open the demo. */
export async function loadDemoCsvs(): Promise<{ instructorCsvText: string; classProfileCsvText: string }> {
  const [instructorCsv, classProfileCsv] = await Promise.all([
    import('./mock-availability-form.csv?raw'),
    import('./mock-class-profile.csv?raw'),
  ])
  return { instructorCsvText: instructorCsv.default, classProfileCsvText: classProfileCsv.default }
}
