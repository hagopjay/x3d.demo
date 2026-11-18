"""v2 mapping = v1 mapping (mapping_v1.py, unchanged) minus the rows v2 supersedes, plus rows found with the bilingual OntoMathPro crawl.
Grades as in v1: C exactMatch + id/label fetched live; L close/broad/related or definition not opened; S guess, analogy or false friend."""
from mapping_v1 import LESSONS, LINKS as _L1, GAPS as _G1
_DROP={("integral","omp","E2855"),("vector_field","omp","E2698"),("waves","ph","2375c1d2-a3fc-4d5b-8fde-4f9029004962"),("waves","ph","0a677b11-f06d-4ced-9385-cf0bf1061a59")}
LINKS=[l for l in _L1 if l[:3] not in _DROP]
LINKS+=[
 ("integral","omp","E2865","exactMatch","C","Russian-only 'интеграл Римана' (Riemann integral); v1 had only the generic E2855"),
 ("integral","omp","E2855","broadMatch","L","Russian-only 'интеграл', generic"),
 ("vector_field","omp","E246","exactMatch","C","Field of vectors / векторное поле; v1 wrongly implied no generic class existed"),
 ("vector_field","omp","E247","narrowMatch","L","Killing vector field"),
 ("linear","om","linalgeig2:eigenvalue","exactMatch","C",""),("linear","om","linalgeig2:eigenvector","exactMatch","C",""),
 ("fourier","omp","E2132","relatedMatch","L","Trigonometrical Fourier constant (coefficients)"),
 ("lorenz","omp","E2070","closeMatch","L","Runge-Kutta four-termed formula; definition not opened"),
 ("gradient","omp","E691","closeMatch","L","Method of steepest descent"),
 ("taylor","omp","E3072","closeMatch","L","Russian-only 'ряд Маклорена' (Maclaurin series)"),
 ("waves","omp","E1931","closeMatch","L","Oscillation equation (Уравнение колебаний): a wave-type equation, definition not opened"),
 ("waves","omp","E1520","relatedMatch","S","FALSE FRIEND: 'wavelet' is a localised basis function, not a travelling wave"),
 ("waves","ph","2375c1d2-a3fc-4d5b-8fde-4f9029004962","relatedMatch","S","Nonlinear waves: lesson is linear superposition, a neighbour only"),
 ("bayes","omp","E2000","exactMatch","C","Bayesian formula (формула Байеса)"),
 ("lagrange","omp","E2722","exactMatch","C","'Langrangian multiplier' (source typo) / множитель Лагранжа"),
 ("lagrange","omp","E3239","relatedMatch","S","Lagrangian (mechanics sense): a neighbour, not the multiplier"),
 ("lagrange","omp","E1920","relatedMatch","S","Euler-Lagrange equation: calculus of variations, not constrained optimisation"),
 ("aliasing","omp","E1523","relatedMatch","S","Kotelnikov-Shannon wavelet: shares the theorem's name, not the lesson's concept"),
 ("refraction","omp","E1041","relatedMatch","S","FALSE FRIEND: 'Fermat number' is not Fermat's principle"),
 ("refraction","omp","E370","relatedMatch","S","Variational problem: Fermat's principle is variational, the class is generic"),
 ("probability","omp","E1856","exactMatch","C","Central limit theorem"),
 ("least_squares","omp","E2624","closeMatch","L","Linear regression"),
 ("least_squares","omp","E1450","closeMatch","L","Projection (the closest reachable point is an orthogonal projection)"),
 ("probability","oe","A007318","relatedMatch","L","Pascal's triangle (binomial coefficients): the coin-count numbers"),
 ("probability","oe","A000984","relatedMatch","L","Central binomial coefficients: the peak counts of the bell"),
]
# v1 gaps that the bilingual crawl REFUTED are dropped here and listed in ERRATA-v1.md: waves/omp (E1931 'Oscillation equation').
GAPS=[g for g in _G1 if g[:2]!=("waves","omp")]
