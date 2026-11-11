import { Link } from "react-router";

/**
 * Detail page opened from a card of the homepage: a back link and one large
 * card, on the same background as the other pages.
 */
export const InfoPage = ({ title, children }) => (
  <div className="w-full max-w-4xl px-6 py-16 text-white">
    <Link
      to="/"
      className="mb-6 inline-flex items-center gap-2 text-sm text-slate-300 transition-colors hover:text-sky-300"
    >
      <span aria-hidden="true">←</span>
      Back to home
    </Link>

    <section className="min-h-[24rem] rounded-2xl border border-white/15 bg-[#0e1622]/80 p-8 shadow-xl backdrop-blur-md sm:p-10">
      <h1 className="text-3xl font-bold text-sky-300">{title}</h1>

      <div className="mt-6 leading-relaxed text-slate-300">{children}</div>
    </section>
  </div>
);