import unittest,threading,urllib.request,gzip,hashlib,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from serve import Handler,ThreadingHTTPServer,ROOT
class ServerWitness(unittest.TestCase):
 @classmethod
 def setUpClass(cls):cls.s=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=cls.s.serve_forever,daemon=True).start();cls.url=f'http://127.0.0.1:{cls.s.server_port}/'
 @classmethod
 def tearDownClass(cls):cls.s.shutdown();cls.s.server_close()
 def get(self,path,enc):return urllib.request.urlopen(urllib.request.Request(self.url+path,headers={'Accept-Encoding':enc}))
 def test_gzip(self):
  with self.get('data/worlds/pantheon/pantheon.x3d','gzip') as r:
   b=r.read();self.assertEqual(r.headers['Content-Encoding'],'gzip');self.assertEqual(gzip.decompress(b),(ROOT/'data/worlds/pantheon/pantheon.x3d').read_bytes());self.assertLess(len(b),.4*(ROOT/'data/worlds/pantheon/pantheon.x3d').stat().st_size)
 def test_identity(self):
  with self.get('data/worlds/pantheon/pantheon.x3d','gzip;q=0') as r:self.assertIsNone(r.headers['Content-Encoding']);r.read()
 def test_binary_not_double_encoded(self):
  with self.get('data/bird/bird.x3d.gz','gzip') as r:self.assertIsNone(r.headers['Content-Encoding']);self.assertEqual(r.read(),(ROOT/'data/bird/bird.x3d.gz').read_bytes())
 def test_missing(self):
  with self.assertRaises(urllib.error.HTTPError):self.get('missing-fixture.x3d','gzip')
if __name__=='__main__':unittest.main()
