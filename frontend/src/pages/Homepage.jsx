
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

      {/* Decorative cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-5xl">

        <div className="rounded-2xl border border-white/15 bg-[#0e1622]/80 backdrop-blur-md p-8 text-center shadow-xl">


          <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-5 text-sky-300"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" /><path d="M7 2v20" /><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" /></svg>


          <h2 className="text-xl font-semibold text-sky-300 mb-3">
            Alpine Cuisine
          </h2>
          <p className="text-slate-300 leading-relaxed">
            Discover authentic mountain flavors and enjoy delicious
            meals prepared with care.
          </p>
        </div>

        <div className="rounded-2xl border border-white/15 bg-[#0e1622]/80 backdrop-blur-md p-8 text-center shadow-xl">

          <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-5 text-sky-300"><path d="m8 3 4 8 5-5 5 15H2L8 3z" /><path d="M4.14 15.08c2.62-1.57 5.24-1.43 7.86.42 2.74 1.94 5.49 2 8.23.19" /></svg>

          <h2 className="text-xl font-semibold text-sky-300 mb-3">
            Breathtaking Views
          </h2>
          <p className="text-slate-300 leading-relaxed">
            Relax and admire the beauty of the mountains
            in a peaceful alpine atmosphere.
          </p>
        </div>

        <div className="rounded-2xl border border-white/15 bg-[#0e1622]/80 backdrop-blur-md p-8 text-center shadow-xl">

          <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-5 text-sky-300"><path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5" /></svg>

          <h2 className="text-xl font-semibold text-sky-300 mb-3">
            Memorable Moments
          </h2>
          <p className="text-slate-300 leading-relaxed">
            Share special moments with friends and family
            in a welcoming mountain retreat.
          </p>
        </div>

      </div>
    </div>
  );
};
