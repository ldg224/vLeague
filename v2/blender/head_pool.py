# V2 faces: the pool of scanned Mixamo heads the players wear (headswap.py), and which one each player gets. The pick hashes the
# player's id, so a man keeps the same face in every match and every render. Raw heads stay private in Plans/vLeague/v2-mixamo/heads
# (re-fetch with Plans/vLeague/tools/v2/mx_heads.py <Name>).
#   python v2/blender/head_pool.py <player id> ...   -> the head for each
import hashlib, sys

# name on Mixamo -> file. Only heads that pass a close-up and a match-camera check go in.
# Tried and left out (27 Nov 2026): remy (hair cards render broken, painted eyes), james (headphones, skull cut by them), brian (a
# hole under the chin where his polo collar sat in the scan).
POOL = ['adam', 'josh', 'joe', 'david', 'bryce', 'lewis', 'leonard']

def head_for(player_id, pool=POOL):
    h = int(hashlib.sha1(str(player_id).encode()).hexdigest()[:8], 16)
    return pool[h % len(pool)]

if __name__ == '__main__':
    for pid in sys.argv[1:]: print(pid, head_for(pid))
