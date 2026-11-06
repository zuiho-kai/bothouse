import api from './client';

/** 记忆论坛页 (#1143): one memory = one post, ranked by the gate (contrib/gate/forum_page.py). */
export interface ForumVoter {
  /** "outcome" = the user's reaction scored at night; "self:<role>" = a role said it used this one */
  who: string;
  n: number;
}

export interface ForumPost {
  /** the 10-hex id `bothouse ctx` / memvote.py take */
  id: string;
  title: string;
  rest: string;
  page: string;
  page_title: string;
  page_desc: string;
  ups: number;
  downs: number;
  score: number;
  folded: boolean;
  /** false: the line was edited or removed from its page; title is what was pushed back then */
  alive: boolean;
  pushed: number;
  cited: number;
  /** unix seconds; 0 = unknown */
  last: number;
  voters: ForumVoter[];
}

export interface ForumData {
  on: boolean;
  rounds: number;
  ups: number;
  downs: number;
  cited: number;
  last_vote: number;
  posts: ForumPost[];
}

export interface ForumResp {
  /** the local gate answers at all */
  running: boolean;
  forum?: ForumData;
  error?: string;
}

export const getForum = () => api.get<ForumResp>('/forum');
