# tier S..D per RFC section 2.3. Illustrative curated set, authored for this PoC.
NODES = {
 'array':'S','hash-map':'S','recursion':'S','binary-search':'S','two-pointers':'S','dfs':'S','bfs':'S','dp':'S',
 'linked-list':'A','stack':'A','queue':'A','heap':'A','bst':'A','graph':'A','sliding-window':'A','prefix-sum':'A','backtracking':'A',
 'greedy':'A','divide-conquer':'A','merge-sort':'A','quicksort':'A','memoization':'A',
 'union-find':'B','trie':'B','dijkstra':'B','topo-sort':'B','monotonic-stack':'B','intervals':'B','tabulation':'B','heap-sort':'B','counting-sort':'B','mst':'B',
 'avl':'C','segment-tree':'C','fenwick':'C','bellman-ford':'C','bit-manip':'C','string-hashing':'C',
 'kmp':'D','floyd':'D',
}
HE = [
 ('sorted-array tricks',['binary-search','two-pointers','intervals','merge-sort','prefix-sum']),
 ('divide and conquer',['divide-conquer','merge-sort','quicksort','binary-search','segment-tree']),
 ('graph traversal',['graph','bfs','dfs','topo-sort','dijkstra','bellman-ford','floyd']),
 ('dynamic programming',['dp','memoization','tabulation','floyd','bellman-ford','kmp']),
 ('window and stack tricks',['sliding-window','monotonic-stack','two-pointers','queue','prefix-sum']),
 ('heap-powered',['heap','dijkstra','heap-sort','mst','greedy']),
 ('hash-based',['hash-map','string-hashing','trie','sliding-window','union-find']),
 ('tree structures',['bst','avl','trie','segment-tree','fenwick','heap']),
 ('backtracking search',['recursion','backtracking','dfs','memoization']),
 ('linear ADTs',['array','linked-list','stack','queue']),
 ('greedy and sort',['greedy','intervals','heap','quicksort','mst']),
 ('connectivity',['union-find','mst','graph','bfs']),
 ('non-comparison',['counting-sort','bit-manip','array','hash-map']),
 ('range queries',['prefix-sum','fenwick','segment-tree','array']),
 ('sorting',['merge-sort','quicksort','heap-sort','counting-sort']),
]
