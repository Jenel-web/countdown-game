import { MMR_LOSS, MMR_WIN } from '@/lib/ranks';

const EXAMPLE_TILES = [75, 50, 6, 3, 8, 2];

const STEPS = [
  {
    num: '01',
    label: 'DEAL',
    title: 'Six tiles, one target',
    body: 'A target from 100 to 999.',
    showTiles: true,
  },
  {
    num: '02',
    label: 'BUILD',
    title: '30 seconds to solve',
    body: 'Combine tiles with + − × ÷. Subtraction stays positive, division is exact.',
    showTiles: false,
  },
  {
    num: '03',
    label: 'SCORE',
    title: 'Closest wins the round',
    body: 'An exact hit scores 1.00. Ties go to the faster player.',
    showTiles: false,
  },
  {
    num: '04',
    label: 'WIN',
    title: 'First to 5.00 points',
    body: `Winner gains ${MMR_WIN} MMR, loser drops ${MMR_LOSS}.`,
    showTiles: false,
  },
];

/** Always-visible explainer of one round, shown on the lobby. */
export default function HowRoundWorks() {
  return (
    <div className="glass-panel rounded-xl p-stack-lg flex flex-col gap-stack-md">
      <h2 className="font-label-caps text-label-caps text-on-surface-variant">HOW A ROUND WORKS</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-stack-lg gap-y-stack-md">
        {STEPS.map((step) => (
          <div key={step.num} className="flex flex-col gap-1">
            <span className="font-mono text-xs font-bold tracking-widest text-primary-container">
              {step.num} {step.label}
            </span>
            <h3 className="font-semibold text-on-surface">{step.title}</h3>
            {step.showTiles && (
              <div className="flex flex-wrap gap-1.5 py-1" aria-label="Example tiles">
                {EXAMPLE_TILES.map((value, i) => (
                  <span
                    key={i}
                    className="min-w-[30px] rounded-lg border border-outline-variant bg-surface-container-high px-1.5 py-0.5 text-center font-mono text-[11px] font-semibold text-on-surface"
                  >
                    {value}
                  </span>
                ))}
              </div>
            )}
            <p className="font-body-sm text-body-sm text-on-surface-variant">{step.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
