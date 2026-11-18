# ECO A-E overlay. Opening names + ECO ranges: authored from the standard ECO classification
# (cross-checked for the major families against the Wikipedia list of chess openings; the minor
# ranges are from memory, graded Likely). Thematic groupings and the engine<->DSA bridges are the
# author's judgement, not a published taxonomy.
ECO = {  # name: (volume, range)
 'Bird':('A','A02-A03'),'Reti':('A','A04-A09'),'English':('A','A10-A39'),'Trompowsky':('A','A45'),
 'Budapest':('A','A51-A52'),'Benko':('A','A57-A59'),'Modern Benoni':('A','A60-A79'),'Dutch':('A','A80-A99'),
 'Scandinavian':('B','B01'),'Alekhine':('B','B02-B05'),'Modern Defence':('B','B06'),'Pirc':('B','B07-B09'),
 'Caro-Kann':('B','B10-B19'),'Smith-Morra':('B','B21'),'Sveshnikov':('B','B33'),'Kan':('B','B41-B43'),
 'Taimanov':('B','B46-B49'),'Dragon':('B','B70-B79'),'Scheveningen':('B','B80-B89'),'Najdorf':('B','B90-B99'),
 'French':('C','C00-C19'),'Danish':('C','C21'),'Vienna':('C','C25-C29'),"Kings Gambit":('C','C30-C39'),
 'Latvian':('C','C40'),'Philidor':('C','C41'),'Petrov':('C','C42-C43'),'Scotch':('C','C44-C45'),
 'Four Knights':('C','C47-C49'),'Italian':('C','C50-C54'),'Evans Gambit':('C','C51-C52'),
 'Two Knights':('C','C55-C59'),'Ruy Lopez':('C','C60-C99'),
 'Veresov':('D','D01'),'London':('D','D02'),'Colle':('D','D04-D05'),'Albin':('D','D08-D09'),'Slav':('D','D10-D19'),
 'QGA':('D','D20-D29'),'Tarrasch':('D','D32-D34'),'QGD':('D','D30-D69'),'Semi-Slav':('D','D43-D49'),'Grunfeld':('D','D70-D99'),
 'Catalan':('E','E00-E09'),'Bogo-Indian':('E','E11'),'Queens Indian':('E','E12-E19'),'Nimzo-Indian':('E','E20-E59'),
 'Kings Indian':('E','E60-E99'),
}
VOL={'A':'Flank openings','B':'Semi-open games','C':'Open games and French','D':'Closed and semi-closed','E':'Indian defences'}
ENG={'minimax':'S','alpha-beta':'A','transposition-table':'A','zobrist-hash':'B','opening-book':'B','iterative-deepening':'B','move-ordering':'C','quiescence':'C'}
HE_ECO=[(f'ECO {v}: {VOL[v]}',[n for n,(vv,_) in ECO.items() if vv==v],'eco') for v in 'ABCDE']+[
 ('1.e4 e5 open games',['Ruy Lopez','Italian','Scotch','Petrov','Philidor','Vienna',"Kings Gambit",'Danish','Latvian','Evans Gambit','Four Knights','Two Knights'],'eco'),
 ('Sicilian family',['Najdorf','Dragon','Scheveningen','Sveshnikov','Taimanov','Kan','Smith-Morra'],'eco'),
 ('Gambits',["Kings Gambit",'Danish','Evans Gambit','Latvian','Benko','Budapest','Albin','QGA','Smith-Morra'],'eco'),
 ('Hypermodern',['Reti','English','Kings Indian','Grunfeld','Nimzo-Indian','Queens Indian','Modern Defence','Pirc','Catalan','Alekhine'],'eco'),
 ('Fianchetto structures',['Reti','English','Catalan','Dragon','Kings Indian','Modern Defence','Bird'],'eco'),
 ('Queen-pawn closed',['QGD','Slav','Semi-Slav','Tarrasch','Colle','London','QGA','Catalan','Veresov'],'eco'),
 ('Solid defences',['French','Caro-Kann','Scandinavian','Philidor','Pirc','Slav','Petrov'],'eco'),
 ('Sharp counterplay',['Najdorf','Dragon','Benko','Kings Indian','Grunfeld','Budapest','Dutch','Modern Benoni'],'eco'),
 ('Indian defences',['Kings Indian','Nimzo-Indian','Queens Indian','Bogo-Indian','Modern Benoni','Grunfeld','Benko'],'eco'),
 ('Engine alpha-beta search',['minimax','alpha-beta','move-ordering','iterative-deepening','quiescence'],'eco'),
 ('Engine hash tables',['transposition-table','zobrist-hash','opening-book'],'eco'),
]
HE_BRIDGE=[
 ('Search is recursion',['minimax','alpha-beta','recursion','backtracking','dfs','memoization'],'bridge'),
 ('Transposition = memoization by hashing',['transposition-table','zobrist-hash','memoization','hash-map','string-hashing','dp'],'bridge'),
 ('Opening book is a trie',['opening-book','trie','hash-map','Ruy Lopez','Najdorf','QGD','Kings Indian','Nimzo-Indian'],'bridge'),
 ('Move ordering is a priority sort',['move-ordering','heap','greedy','quicksort'],'bridge'),
 ('Iterative deepening = BFS by DFS',['iterative-deepening','bfs','dfs','recursion'],'bridge'),
]
