// Template for config.js — copy this file to `config.js` and fill in
// your Supabase project values.
//
//   cp config.example.js config.js
//
// `config.js` is gitignored so your keys never get committed.

export const SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';

// The "anon public" key from Supabase → Project Settings → API.
// This key is SAFE to expose in client-side code — its permissions are
// controlled by Row Level Security policies in the database.
export const SUPABASE_ANON_KEY = 'eyJ...your-anon-key-here...';
