
CREATE TABLE public.public_profiles (
  user_id UUID NOT NULL PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  bio TEXT,
  avatar_url TEXT,
  is_public BOOLEAN NOT NULL DEFAULT false,
  allow_copy BOOLEAN NOT NULL DEFAULT false,
  verified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.public_profiles TO authenticated;
GRANT ALL ON public.public_profiles TO service_role;
ALTER TABLE public.public_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read public profiles" ON public.public_profiles FOR SELECT
  TO authenticated USING (is_public = true OR user_id = auth.uid());
CREATE POLICY "manage own profile" ON public.public_profiles FOR ALL
  TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.profile_stats (
  user_id UUID NOT NULL PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  total_return_pct NUMERIC NOT NULL DEFAULT 0,
  win_rate NUMERIC NOT NULL DEFAULT 0,
  sharpe NUMERIC NOT NULL DEFAULT 0,
  max_drawdown_pct NUMERIC NOT NULL DEFAULT 0,
  trades_count INTEGER NOT NULL DEFAULT 0,
  followers_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profile_stats TO authenticated;
GRANT ALL ON public.profile_stats TO service_role;
ALTER TABLE public.profile_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read stats of public profiles" ON public.profile_stats FOR SELECT
  TO authenticated USING (
    user_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.public_profiles p
      WHERE p.user_id = profile_stats.user_id AND p.is_public = true
    )
  );
CREATE POLICY "own stats writes" ON public.profile_stats FOR ALL
  TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.follows (
  follower_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, following_id),
  CHECK (follower_id <> following_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.follows TO authenticated;
GRANT ALL ON public.follows TO service_role;
ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own follows" ON public.follows FOR SELECT
  TO authenticated USING (follower_id = auth.uid() OR following_id = auth.uid());
CREATE POLICY "manage own follows" ON public.follows FOR ALL
  TO authenticated USING (follower_id = auth.uid()) WITH CHECK (follower_id = auth.uid());
CREATE INDEX follows_following_idx ON public.follows(following_id);

CREATE TABLE public.copy_subscriptions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  follower_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  leader_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  allocation_pct NUMERIC NOT NULL DEFAULT 10 CHECK (allocation_pct > 0 AND allocation_pct <= 100),
  max_position_size NUMERIC NOT NULL DEFAULT 100 CHECK (max_position_size > 0),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (follower_id, leader_id),
  CHECK (follower_id <> leader_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.copy_subscriptions TO authenticated;
GRANT ALL ON public.copy_subscriptions TO service_role;
ALTER TABLE public.copy_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own copy subs" ON public.copy_subscriptions FOR SELECT
  TO authenticated USING (follower_id = auth.uid() OR leader_id = auth.uid());
CREATE POLICY "manage own copy subs" ON public.copy_subscriptions FOR ALL
  TO authenticated USING (follower_id = auth.uid()) WITH CHECK (follower_id = auth.uid());
