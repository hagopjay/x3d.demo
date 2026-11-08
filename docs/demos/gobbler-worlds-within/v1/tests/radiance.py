import unittest,sys
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
import radiance as r
class RadianceWitness(unittest.TestCase):
 def test_constant_energy(self):
  old=r.environment
  try:
   r.environment=lambda n:np.ones_like(n)*np.array([.2,.4,1.1])
   for rough in [.1,.5,1]:np.testing.assert_allclose(r.prefilter(r.directions(16,8),rough,32),np.broadcast_to([.2,.4,1.1],(8,16,3)),atol=1e-12)
  finally:r.environment=old
 def test_rgbm_range(self):
  with self.assertRaises(ValueError):r.encode(np.ones((2,2,3))*9)
 def test_roundtrip(self):
  x=r.environment(r.directions(64,32));self.assertLess(float(np.max(np.abs(r.decode(r.encode(x))-x))),.01)
 def test_finite_levels(self):
  n=r.directions(16,8)
  for rough in [0,.2,.4,.6,.8,1]:
   x=r.prefilter(n,rough,32);self.assertTrue(np.isfinite(x).all());self.assertTrue((x>=0).all())
if __name__=='__main__':unittest.main()
