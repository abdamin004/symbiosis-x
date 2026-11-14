import research from "../../../../catalogs/crew/spaceflight-research.json";

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
      <h2 className="mt-4 font-semibold">NASA research context</h2>
      <p className="mt-2 text-sm text-slate-700">{research.mission}. {research.time_basis}</p>
      <ul className="mt-2 space-y-2 text-sm text-slate-700">
        {research.datasets.map(({id, url, sample, assays, timepoints}) => (
          <li key={id}>
            <a className="font-semibold text-selection underline" href={url}>NASA OSDR · {id}</a>
            {" · "}{sample}. {assays}. {timepoints}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-sm text-slate-700">The laboratory series have assay-specific units. Examples include glucose in mg/dL, sodium in mmol/L, Eve protein concentrations in pg/mL, and Alamar signals in NPQ.</p>
      <p className="mt-2 text-sm text-slate-700">{research.physiology.co2_hrv} {research.physiology.sleep} <a className="text-selection underline" href={research.physiology.url}>{research.physiology.citation}</a></p>
      <p className="mt-2 text-sm text-slate-700">{research.standard_measures.scope} <a className="text-selection underline" href={research.standard_measures.url}>{research.standard_measures.citation}</a></p>
      <p className="mt-2 text-sm text-slate-700">The study’s scope is limited by its small cohort, short mission and assay coverage. Crew assessments use each fictional astronaut’s accepted readings, baseline, and applicable Earth-based references.</p>
      <p className="mt-2 text-sm text-slate-700">The related PBMC study gives an example of measuring gene expression with single-nucleus RNA sequencing. <a className="text-selection underline" href="https://osdr.nasa.gov/bio/repo/data/studies/OSD-570/">NASA OSDR · OSD-570</a></p>
      <p className="mt-2 text-sm"><a className="text-selection underline" href="https://www.nasa.gov/reference/risk-of-altered-immune-system-responses/">NASA immune system risk summary</a></p>
      <p className="mt-3 text-sm text-slate-700">The Galley simulation records surface, time and quality for its fictional inspections. NASA’s station study tracks location and time separately from crew observations. <a className="text-selection underline" href="https://www.nasa.gov/ames/space-biosciences/microbial-tracking-2/">NASA Microbial Tracking-2</a></p>
    </details>
  );
}
