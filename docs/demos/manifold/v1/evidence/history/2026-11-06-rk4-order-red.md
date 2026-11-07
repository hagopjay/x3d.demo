# Red run, 6 Nov: geodesic_rk4_order 3.488 (limit 0.1)

All other witnesses passed (curvature 5.1e-15, Gauss-Bonnet 4.5e-14, formulation 9.6e-9, RK4 error at the
page's step 1.37e-4, Clairaut 1.8e-11, seeds exact). The order witness was computed per trace, and a trace
that left the square earlier at one step than at another was compared beyond the reference's end, where
solve_ivp's dense output extrapolates. The exploration had taken the order from the worst error over all
traces and read 3.98 to 4.00. Cause: the witness, not the integrator (Loom law 26). Fix: compare every run
only over arc length the reference covers, and take the order per trace from errors above rounding.
