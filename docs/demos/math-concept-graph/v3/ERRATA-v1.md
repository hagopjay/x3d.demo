# Errata for math-concept-graph v1 (found by v2)

| # | v1 said | Found | Source |
|---|---|---|---|
| 1 | Gap: no OntoMathPro wave equation class | E1931 Oscillation equation | Уравнение колебаний exists (closeMatch, L) | quarantined crawl, en+ru labels |
| 2 | Vector field: only E2698 'Vector function' (S), 'no generic class' implied | E246 'Field of vectors' / векторное поле is the generic class (C) | crawl |
| 3 | Integral lesson: generic E2855 | E2865 'интеграл Римана' (Riemann integral) is better (C); E2855 kept as broad L | crawl |
| 4 | 737 Russian-only classes (regex on the listing) | 731 Russian-only by page labels | crawl |

Cause: the class listing shows one label per class, so v1's gap regexes saw English only where an English label existed. Rule for later scouts: search every language label before declaring a gap.
