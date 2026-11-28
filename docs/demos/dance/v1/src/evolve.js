// Evolution with a human in the loop. Each dancer has a small population of
// genomes; one performs at a time for a stint (N bars). Fitness = automatic
// score (musicality, variety, resonance, sliding…) + your ratings, which weigh
// more. After every genome has had a stint, the next generation is bred.
import { randomGenome, crossover, mutate, SEEDS } from "./genome.js";
import { rng } from "./math.js";

export class Evolver {
  constructor(key, { size = 6, seed = 3, stintBars = 8, humanWeight = 1.5, initial = null } = {}) {
    this.key = key; this.r = rng(seed); this.stintBars = stintBars; this.humanWeight = humanWeight;
    const base = SEEDS[key] ?? {};
    // start from a trained population when one is given (its genes fill any new ones from the seed)
    this.pop = initial?.length
      ? initial.slice(0, size).map((g) => ({ ...randomGenome(this.r, base), ...g, trans: g.trans ?? randomGenome(this.r, base).trans }))
      : Array.from({ length: size }, (_, i) => {
          const g = randomGenome(this.r, base);
          if (i > 0) mutate(g, this.r, 0.25);
          return g;
        });
    this.gen = 0; this.idx = 0;
    this.fit = new Map(); // id -> {auto, human, n}
    this.log = [];        // lineage records
  }
  get current() { return this.pop[this.idx]; }

  rate(delta, note = "") {
    const g = this.current, f = this._f(g.id);
    f.human += delta; f.ratings.push({ delta, note, at: Date.now() });
  }
  _f(id) {
    if (!this.fit.has(id)) this.fit.set(id, { auto: 0, human: 0, n: 0, ratings: [] });
    return this.fit.get(id);
  }

  /** End the current stint with an automatic score; returns true when a new generation was bred. */
  endStint(auto) {
    const g = this.current, f = this._f(g.id);
    f.auto = (f.auto * f.n + auto.total) / (f.n + 1); f.n++; f.parts = auto.parts;
    this.idx++;
    if (this.idx < this.pop.length) return false;
    this.breed();
    return true;
  }

  fitness(g) {
    const f = this._f(g.id);
    return f.auto + this.humanWeight * f.human;
  }

  breed() {
    const ranked = [...this.pop].sort((a, b) => this.fitness(b) - this.fitness(a));
    this.log.push({
      gen: this.gen,
      ranked: ranked.map((g) => ({ id: g.id, parents: g.parents, fitness: +this.fitness(g).toFixed(4), ...this._f(g.id), genome: g })),
    });
    const elite = ranked.slice(0, 2);
    const next = elite.map((g) => g);
    const pick = () => { // tournament of 3
      const t = Array.from({ length: 3 }, () => ranked[Math.floor(this.r() * ranked.length)]);
      return t.sort((a, b) => this.fitness(b) - this.fitness(a))[0];
    };
    while (next.length < this.pop.length) {
      const c = mutate(crossover(pick(), pick(), this.r), this.r, 0.12 / (1 + this.gen * 0.15));
      next.push(c);
    }
    this.gen++;
    this.pop = next; this.idx = 0;
    // elites keep their history; children start fresh
    for (const g of next) if (!elite.includes(g)) this.fit.delete(g.id);
  }
}
