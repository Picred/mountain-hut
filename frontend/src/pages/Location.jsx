import { InfoPage } from "../components/InfoPage";

// Outline icon in a rounded square, same style as the rest of the site.
const IconBadge = ({ children }) => (
  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-300/10 text-sky-300">
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  </span>
);

const WAYS = [
  {
    title: "By car",
    text: "From Turin it takes about 1 h 30 to reach Borgata Fontana. The car park at the end of the road is free and has limited spaces. On summer weekends it can be full by mid-morning.",
    icon: (
      <>
        <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2" />
        <circle cx="7" cy="17" r="2" />
        <path d="M9 17h6" />
        <circle cx="17" cy="17" r="2" />
      </>
    ),
  },
  {
    title: "By public transport",
    text: "The nearest railway station is in Ponte Alto, 12 km from Borgata Fontana. There is no regular bus to the car park, so a taxi is needed for the last part.",
    icon: (
      <>
        <path d="M8 6v6" />
        <path d="M15 6v6" />
        <path d="M2 12h19.6" />
        <path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3" />
        <circle cx="7" cy="18" r="2" />
        <path d="M9 18h5" />
        <circle cx="16" cy="18" r="2" />
      </>
    ),
  },
  {
    title: "On foot",
    text: "Path 215, marked with red and white signs. It is about 4.5 km long, with 560 m of ascent, and takes about 2 h 15. It crosses the forest first, then open pastures.",
    icon: (
      <>
        <path d="M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z" />
        <path d="M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z" />
        <path d="M16 17h4" />
        <path d="M4 13h4" />
      </>
    ),
  },
];

export const LocationPage = () => (
  <InfoPage title="Our location">
    {/* History of the hut. */}
    <div className="flex items-start gap-4 rounded-xl border border-white/10 bg-[#090f19] p-5">
      <IconBadge>
        <path d="m8 3 4 8 5-5 5 15H2L8 3z" />
        <path d="M4.14 15.08c2.62-1.57 5.24-1.43 7.86.42 2.74 1.94 5.49 2 8.23.19" />
      </IconBadge>

      <p>
        Rifugio Pian dei Larici was built as a shelter for shepherds and was
        turned into a hut for hikers. It stands at the upper end of Val delle
        Fontane, where the forest ends and the pastures begin.
      </p>
    </div>

    {/* Where the hut is. */}
    <section aria-labelledby="location-how-title" className="mt-10">
      <h2
        id="location-how-title"
        className="mb-4 text-xl font-semibold text-white"
      >
        How to get there
      </h2>

      <p className="mb-6">
        The hut is in Val delle Fontane, about 80 km from Turin. The road ends at
        Borgata Fontana (1,320 m). The hut is 560 m higher, along a path.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        {WAYS.map(({ title, text, icon }) => (
          <article
            key={title}
            className="rounded-xl border border-white/10 bg-[#090f19] p-5"
          >
            <div className="mb-4 flex items-center gap-3">
              <IconBadge>{icon}</IconBadge>
              <h3 className="font-semibold text-sky-300">{title}</h3>
            </div>
            <p className="text-sm leading-relaxed text-slate-300">{text}</p>
          </article>
        ))}
      </div>
    </section>
  </InfoPage>
);