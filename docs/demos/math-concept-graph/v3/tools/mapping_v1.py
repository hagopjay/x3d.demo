"""Hand-authored lesson -> ontology mapping for the 18 x3d.mathslab lessons.
Grades: C Confirmed = exactMatch AND the term id + label were fetched live by scout.py in this build;
        L Likely    = id + label fetched live, relation is close/broad/narrow/related, or definition not opened;
        S Suspected = relies on a translation guess, an analogy or a false friend.
A GAP is a Confirmed negative: the stated search found nothing in the stated source (not proof the concept is absent elsewhere)."""
LESSONS = [  # id, title (x3d.mathslab mathlab/catalog.py + lessons_*.py), accent
 ("linear","The Shape of a Matrix","#73dfff"),("derivative","A Secant Becomes a Tangent","#ffc976"),
 ("integral","Build an Area from Samples","#8affcf"),("fourier","A Wave Made of Circles","#e7a5ff"),
 ("lorenz","Two Almost-Identical Beginnings","#ff93b9"),("gradient","Find the Floor of a Valley","#a5b7ff"),
 ("complex","Multiplication Becomes Motion","#ffffff"),("taylor","How Far Can a Local Idea Reach?","#ffffff"),
 ("waves","Two Moving Waves Make Still Nodes","#ffffff"),("svd","A Matrix Reveals Its Favorite Directions","#ffffff"),
 ("bayes","A Positive Signal Changes the Denominator","#ffffff"),("lagrange","The Best Move May Be Forbidden","#ffffff"),
 ("aliasing","Different Motions, Identical Samples","#ffffff"),("heat","Why Fine Detail Melts First","#ffffff"),
 ("refraction","The Fastest Route Bends","#ffffff"),("probability","A Bell Curve from Coin Counts","#ffffff"),
 ("least_squares","The Closest Reachable Point","#ffffff"),("vector_field","A Source Is Not a Whirlpool","#ffffff")]
# sources: omp OntoMathPro (E-number), om OpenMath (cd:symbol), ml MathML 3 content element, ph PhySH concept uuid
LINKS = [ # lesson, src, term, relation, grade, note
 ("linear","omp","E1703","exactMatch","C","Matrix"),("linear","omp","E1403","closeMatch","L","a matrix is a linear map; lesson shows the map"),
 ("linear","om","linalg2:matrix","exactMatch","C",""),("linear","om","linalg1:determinant","exactMatch","C","lesson shows signed area factor = det"),
 ("linear","om","linalg4:eigenvector","exactMatch","C",""),("linear","om","linalg4:eigenvalue","exactMatch","C",""),
 ("linear","ml","determinant","exactMatch","C",""),("linear","ml","matrix","exactMatch","C",""),
 ("derivative","omp","E3040","exactMatch","C","Russian-only label 'Производная функции'"),("derivative","om","calculus1:diff","exactMatch","C",""),
 ("derivative","ml","diff","exactMatch","C",""),("derivative","om","limit1:limit","broadMatch","L","derivative as a limit of secants"),
 ("integral","omp","E2855","broadMatch","L","Russian-only label 'интеграл', generic"),("integral","omp","E2856","closeMatch","L","Darboux integral; definition not opened"),
 ("integral","om","calculus1:defint","exactMatch","C",""),("integral","om","calculus2:integrand","relatedMatch","L",""),("integral","ml","int","exactMatch","C",""),
 ("fourier","omp","E3079","exactMatch","C","Russian-only label 'Ряд Фурье' (Fourier series)"),("fourier","omp","E2975","relatedMatch","L","Fourier transformation"),
 ("lorenz","omp","E598","exactMatch","C","Runge-Kutta method (lesson uses RK4)"),("lorenz","omp","E1897","broadMatch","L","Ordinary differential equation"),
 ("lorenz","omp","E2811","broadMatch","L","Dynamical system"),("lorenz","ph","bb2351de-d2a6-4d4c-a33e-9396bc991c32","exactMatch","C","Chaos"),
 ("lorenz","ph","1ec03196-e8d2-40b7-891a-fc8e4a1cbbdb","broadMatch","L","Chaos & nonlinear dynamics"),
 ("gradient","omp","E472","exactMatch","C","Gradient descent method"),("gradient","omp","E1700","closeMatch","L","Gradient"),
 ("gradient","om","veccalc1:grad","exactMatch","C",""),("gradient","ml","grad","exactMatch","C",""),
 ("gradient","ph","b96ba7a9-cce1-470c-b80c-6dadb2c6b8e9","broadMatch","L","Optimization problems"),
 ("complex","omp","E2127","exactMatch","C","Complex number"),("complex","omp","E1662","closeMatch","L","Argument value"),
 ("complex","om","complex1:complex_polar","exactMatch","C",""),("complex","om","complex1:argument","exactMatch","C",""),("complex","ml","arg","exactMatch","C",""),
 ("taylor","omp","E3071","exactMatch","C","Russian-only label 'Ряд Тейлора'"),("taylor","omp","E2924","closeMatch","L","Russian-only 'Многочлен Тейлора' (polynomial)"),
 ("taylor","omp","E2021","closeMatch","L","Russian-only 'Формула Тейлора'"),
 ("waves","ph","2375c1d2-a3fc-4d5b-8fde-4f9029004962","relatedMatch","S","Nonlinear waves: lesson is linear superposition, so a neighbour only"),
 ("waves","ph","0a677b11-f06d-4ced-9385-cf0bf1061a59","relatedMatch","S","Waves and free surface flows: a neighbour only"),
 ("svd","omp","E3303","relatedMatch","S","'Singular number': probably the operator singular value; definition not opened, English label only"),
 ("svd","omp","E1703","broadMatch","L","Matrix"),("svd","om","linalg4:rank","relatedMatch","S","SVD exposes rank; no SVD symbol exists"),
 ("bayes","omp","E1836","exactMatch","C","Bayes theorem"),("bayes","omp","E2419","closeMatch","L","Conditional probability"),("bayes","omp","E2412","closeMatch","L","A posteriori probability"),
 ("lagrange","omp","E1621","closeMatch","L","Lagrange function; definition not opened"),("lagrange","omp","E3128","broadMatch","L","Russian-only 'Экстремум' (extremum)"),
 ("lagrange","omp","E684","relatedMatch","S","Lagrange method of modified function: unclear it is the multiplier method"),
 ("lagrange","om","minmax1:min","relatedMatch","L","objective being minimised"),("lagrange","ph","b96ba7a9-cce1-470c-b80c-6dadb2c6b8e9","broadMatch","L","Optimization problems"),
 ("aliasing","omp","E3406","closeMatch","L","Kotel'nikov frequency (Nyquist-Shannon); definition not opened"),("aliasing","omp","E3378","relatedMatch","S","Discretization error"),
 ("heat","omp","E1921","exactMatch","C","Russian-only 'Уравнение теплопроводности' (heat equation)"),("heat","omp","E1930","closeMatch","L","Diffusion equation"),
 ("heat","ph","cbf5d6c2-2523-4ba3-abb5-133219e2ce5a","closeMatch","L","Diffusion & random walks"),
 ("refraction","ph","23cdcd6b-ae22-4b6d-92cd-24a9a8bd0577","broadMatch","L","Optics & lasers"),
 ("probability","omp","E2498","exactMatch","C","Binomial distribution"),("probability","omp","E1847","exactMatch","C","Integral de Moivre-Laplace theorem"),
 ("probability","omp","E2514","exactMatch","C","Normal distribution"),("probability","om","s_dist1:mean","relatedMatch","L",""),("probability","om","s_dist1:variance","relatedMatch","L",""),
 ("probability","ml","mean","relatedMatch","L",""),("probability","ml","variance","relatedMatch","L",""),
 ("least_squares","omp","E690","exactMatch","C","Least square method"),
 ("vector_field","om","veccalc1:divergence","exactMatch","C",""),("vector_field","om","veccalc1:curl","exactMatch","C",""),
 ("vector_field","ml","divergence","exactMatch","C",""),("vector_field","ml","curl","exactMatch","C",""),
 ("vector_field","omp","E2698","relatedMatch","S","'Vector function' is not 'vector field'; E249/E251/E253 are manifold-specific kinds"),
]
# GAPS: lesson, src, case-insensitive regex that must match NOTHING in that source's live listing, note
# omp = labels of the 3451 classes at ontomathpro.org/ontology; om = cd:symbol of the 1565 symbols at openmath.org/symbols;
# ml = MathML 3 chapter 4 text (element occurrences); ph = labels of the 544 concepts at physh.org/concepts
GAPS = [
 ("fourier","om","fourier|transform","no Fourier or transform symbol"),("fourier","ml","fourier","no Fourier element"),
 ("taylor","om","taylor|series|maclaurin","no Taylor or series symbol"),("taylor","ml","taylor","no <taylor/>"),
 ("waves","omp","wave equation|string vibration|^wave$|уравнение колебаний|волновое","no wave equation class (wavelet classes only)"),
 ("waves","om","wave","no wave symbol"),("waves","ml","wave","no wave element"),
 ("svd","om","singular|svd","no SVD or singular value symbol"),("svd","ml","svd|singular","no SVD element"),
 ("bayes","om","bayes|probab|random|stats1|prob1","no probability or Bayes symbol (prob1, stats1 CDs also 404)"),("bayes","ml","bayes","no Bayes element"),
 ("lagrange","ml","lagrange|multiplier","no constrained optimisation element"),("lagrange","om","lagrange|multiplier|optim|constraint","no multiplier or optimisation symbol (only minmax1)"),
 ("aliasing","om","sampl|nyquist|alias","no sampling symbol"),("aliasing","ml","nyquist|alias|sampl","no sampling element"),
 ("aliasing","ph","sampling|alias","no sampling concept in the listed 544"),
 ("heat","om","^[a-z_0-9]*:(heat_?eq|heatequation|pde)","no heat equation symbol (SI_DerivedQuantities1:heat is a unit-quantity, not the PDE)"),
 ("heat","ml","heat","no heat equation element"),
 ("refraction","omp","snell|refraction|fermat principle|принцип ферма|преломлен","no Snell, refraction or Fermat principle class (E1041 'Fermat number' is a false friend)"),
 ("refraction","om","refract|snell|optic","no optics symbol"),("refraction","ml","refract|snell","no optics element"),
 ("lorenz","om","runge|odesolve|lorenz|(^|[^a-z])ode:","no ODE solver symbol"),("lorenz","ml","lorenz|runge","no ODE element"),
 ("least_squares","om","regress|least_?squares|lsq","no regression symbol"),("least_squares","ml","regress|least","no regression element"),
 ("probability","ph","probabil","no probability concept in the listed 544"),
 ("vector_field","ph","vector field","no vector field concept"),
]
