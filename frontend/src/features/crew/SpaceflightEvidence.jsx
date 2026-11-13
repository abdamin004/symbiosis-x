export default function SpaceflightEvidence({note}) {
  return (
    <details className="mt-5 rounded-lg border border-slate-200 bg-white p-4">
      <summary className="cursor-pointer font-semibold">Genetics and spaceflight research</summary>
      <dl className="mt-3 space-y-2 text-sm text-slate-700">
        <div>
          <dt className="font-semibold">Inherited trait</dt>
          <dd>A characteristic can run in a family through inherited DNA. {note.inherited_trait}</dd>
        </div>
        <div>
          <dt className="font-semibold">Gene expression</dt>
          <dd>Cells use genes to make RNA and proteins. Expression can vary by cell type and conditions. {note.expression_observation}</dd>
        </div>
      </dl>
      <p className="mt-2 text-sm">
        <a className="text-selection underline" href="https://www.genome.gov/genetics-glossary/Inherited">NHGRI inheritance glossary</a>
        {" · "}<a className="text-selection underline" href="https://www.genome.gov/genetics-glossary/Gene-Expression">NHGRI gene expression glossary</a>
      </p>
      <h2 className="mt-4 font-semibold">Inspiration4 research context</h2>
      <dl className="mt-2 space-y-2 text-sm text-slate-700">
        <div><dt className="font-semibold">Population</dt><dd>Four private astronauts on a three-day mission to low Earth orbit.</dd></div>
        <div><dt className="font-semibold">Serum collection</dt><dd>92, 44 and 3 days before launch, then 1, 45 and 82 days after return.</dd></div>
        <div><dt className="font-semibold">Assays</dt><dd>Comprehensive metabolic panel and multiplex immune and cardiac protein assays.</dd></div>
        <div><dt className="font-semibold">Reported units</dt><dd>Glucose in mg/dL, sodium in mmol/L, Eve protein concentrations in pg/mL, and Alamar signals in NPQ.</dd></div>
        <div><dt className="font-semibold">Applicability</dt><dd>The study describes a small mission cohort. It provides research context for how observations are collected. The Crew assessment uses the accepted readings and personal baseline for this run.</dd></div>
      </dl>
      <p className="mt-2 text-sm"><a className="text-selection underline" href="https://osdr.nasa.gov/bio/repo/data/studies/OSD-575">NASA OSDR serum data · OSD-575 v3</a></p>
      <p className="mt-2 text-sm text-slate-700">The related PBMC study gives an example of measuring gene expression with single-nucleus RNA sequencing. <a className="text-selection underline" href="https://osdr.nasa.gov/bio/repo/data/studies/OSD-570/">NASA OSDR · OSD-570</a></p>
      <p className="mt-2 text-sm"><a className="text-selection underline" href="https://www.nasa.gov/reference/risk-of-altered-immune-system-responses/">NASA immune system risk summary</a></p>
      <p className="mt-3 text-sm text-slate-700">The Galley simulation records surface, time and quality for its fictional inspections. NASA’s station study tracks location and time separately from crew observations. <a className="text-selection underline" href="https://www.nasa.gov/ames/space-biosciences/microbial-tracking-2/">NASA Microbial Tracking-2</a></p>
    </details>
  );
}
