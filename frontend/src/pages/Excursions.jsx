import { InfoPage } from "../components/InfoPage";

const iconProps = {
  xmlns: "http://www.w3.org/2000/svg",
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  className: "mt-0.5 shrink-0 text-amber-300",
};

const NOTES = [
  {
    text: "Wear sturdy shoes and bring a rain jacket and a warm layer, even in summer.",
    icon: (
      <svg {...iconProps}>
        <path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z" />
      </svg>
    ),
  },
  {
    text: "Check the weather forecast before leaving the car park.",
    icon: (
      <svg {...iconProps}>
        <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
      </svg>
    ),
  },
  {
    text: "Mobile coverage is weak or absent along the path.",
    icon: (
      <svg {...iconProps}>
        <rect width="14" height="20" x="5" y="2" rx="2" />
        <path d="M12 18h.01" />
        <path d="m2 2 20 20" />
      </svg>
    ),
  },
  {
    text: "Cards may not work when the connection is down: bring some cash.",
    icon: (
      <svg {...iconProps}>
        <rect width="20" height="12" x="2" y="6" rx="2" />
        <circle cx="12" cy="12" r="2" />
        <path d="M6 12h.01M18 12h.01" />
      </svg>
    ),
  },
];

const EXCURSIONS = [
  {
    name: "Lago Nero",
    altitude: "2,010 m",
    time: "40 min",
    difficulty: "T – Tourist",
    description:
      "Small lake in a basin north-east of the hut, reached by path 215A. The path is short and has no steep sections.",
  },
  {
    name: "Colle della Croce",
    altitude: "2,310 m",
    time: "1 h 30",
    difficulty: "E – Hiking",
    description:
      "Pass between Val Fontana and the neighbouring valley, on the way to Punta Rossa. The last part crosses a stony slope.",
  },
  {
    name: "Punta Rossa",
    altitude: "2,640 m",
    time: "3 h",
    difficulty: "EE – Expert hikers",
    description:
      "Summit reached by the south ridge. Some exposed sections and a short stretch with a fixed chain. Not advised in bad weather.",
  },
];

export const ExcursionsPage = () => (
  <InfoPage title="Breathtaking Views">
    {/* Warnings, highlighted in yellow. */}
    <section aria-labelledby="excursions-notes-title">
      <h2
        id="excursions-notes-title"
        className="mb-4 text-xl font-semibold text-white"
      >
        Before you set off
      </h2>

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {NOTES.map(({ text, icon }) => (
          <li
            key={text}
            className="flex items-start gap-3 rounded-xl border border-amber-300/40 bg-amber-300/10 p-4 text-sm text-amber-100"
          >
            {icon}
            <span>{text}</span>
          </li>
        ))}
      </ul>
    </section>

    {/* Excursions from the hut. */}
    <section aria-labelledby="excursions-list-title" className="mt-10">
      <h2
        id="excursions-list-title"
        className="mb-2 text-xl font-semibold text-white"
      >
        Excursions from the hut
      </h2>
      <p className="mb-5 text-sm text-slate-400">
        Times are one way, starting from the hut.
      </p>

      <div className="space-y-4">
        {EXCURSIONS.map(({ name, altitude, time, difficulty, description }) => (
          <article
            key={name}
            className="rounded-xl border border-white/10 bg-[#090f19] p-5"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <h3 className="text-lg font-semibold text-sky-300">{name}</h3>

              <dl className="grid grid-cols-3 gap-x-4 gap-y-2 text-sm sm:grid-cols-[6rem_6rem_11rem]">
                <div>
                  <dt className="text-xs text-slate-400">Altitude</dt>
                  <dd className="font-medium text-white">{altitude}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400">Time</dt>
                  <dd className="font-medium text-white">{time}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400">Level</dt>
                  <dd className="font-medium text-white">{difficulty}</dd>
                </div>
              </dl>
            </div>

            <p className="mt-3 text-sm leading-relaxed text-slate-300">
              {description}
            </p>
          </article>
        ))}
      </div>
    </section>
  </InfoPage>
);