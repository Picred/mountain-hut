import { Link } from "react-router";

const cardClass =
  "group block h-full rounded-2xl border border-white/15 bg-[#0e1622]/80 backdrop-blur-md p-8 text-center shadow-xl transition-colors hover:border-sky-300/50 hover:bg-[#0e1622] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300";

const iconClass = "mx-auto mb-5 text-sky-300";
const titleClass = "text-xl font-semibold text-sky-300 mb-3";

export const Homepage = () => {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-white">

      {/* Welcome section */}
      <div className="max-w-3xl text-center mb-12">
        <h1 className="text-4xl md:text-5xl font-bold mb-5">
          Welcome to Mountain Hut
        </h1>

        <p className="text-lg text-slate-200 leading-relaxed">
          Escape to the mountains, enjoy authentic alpine cuisine,
          and make unforgettable memories surrounded by nature.
        </p>
      </div>

      {/* Cards that open the detail pages */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-5xl">

        <Link to="/location" className={cardClass}>
          <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={iconClass} aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></svg>

          <h2 className={titleClass}>Our location</h2>
          <p className="text-slate-300 leading-relaxed">
            Val di Fontane
            <br />
            Piedmont, Italy
            <br />
            Altitude: 1880m
            
          </p>
        </Link>

        <Link to="/services" className={cardClass}>
          <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={iconClass} aria-hidden="true"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" /><path d="M7 2v20" /><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" /></svg>

          <h2 className={titleClass}>Our services</h2>
          <ul className="text-slate-300 leading-relaxed">
            <li>Meals</li>
            <li>Overnight stays</li>
            <li>Safety services</li>
          </ul>
        </Link>

        <Link to="/excursions" className={cardClass}>
          <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={iconClass} aria-hidden="true"><path d="m8 3 4 8 5-5 5 15H2L8 3z" /><path d="M4.14 15.08c2.62-1.57 5.24-1.43 7.86.42 2.74 1.94 5.49 2 8.23.19" /></svg>

          <h2 className={titleClass}>Breathtaking views</h2>
          <p className="text-slate-300 leading-relaxed">
            Discover the Alps with
            <br />
            some of the most
            <br />
            beautiful excursions in Italy
          </p>
        </Link>

      </div>
    </div>
  );
};