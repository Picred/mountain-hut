export const Footer = () => (
  <footer className="relative bg-[#080e18]/90 backdrop-blur-md">
    {/* Soft fade between the page background and the footer. */}
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 -top-8 h-8 bg-gradient-to-t from-[#080e18]/90 to-transparent"
    />

    <div className="mx-auto max-w-6xl px-4 py-1.5 sm:px-6">
      <dl className="flex flex-wrap items-center justify-center gap-x-8 gap-y-0.5 text-xs">
        <div className="flex items-baseline gap-2">
          <dt className="text-[11px] text-slate-400">Phone</dt>
          <dd className="text-slate-300">+39 011 000 0000</dd>
        </div>
        <div className="flex items-baseline gap-2">
          <dt className="text-[11px] text-slate-400">Email</dt>
          <dd className="text-slate-300">mountainhut2627@gmail.com</dd>
        </div>
      </dl>
    </div>
  </footer>
);