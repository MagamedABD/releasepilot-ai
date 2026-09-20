/**
 * Типы схемы базы данных.
 *
 * Источник истины — файлы в supabase/migrations. Этот файл описывает их
 * на стороне TypeScript и сверяется со схемой живой базы скриптом
 * scripts/check-db-types.ts (он ходит в OpenAPI-описание, которое Supabase
 * отдаёт по /rest/v1/, и сравнивает состав таблиц и колонок).
 *
 * Правило: сначала миграция, потом этот файл, потом прогон сверки.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type AppRole = 'owner' | 'admin' | 'manager' | 'lead' | 'viewer';
export type TeamKind = 'frontend' | 'backend' | 'qa' | 'analytics' | 'design' | 'other';
export type TaskStatus = 'backlog' | 'in_progress' | 'review' | 'testing' | 'done' | 'cancelled';
export type TaskPriority = 'P0' | 'P1' | 'P2' | 'P3';
export type ReleaseStatus = 'planned' | 'active' | 'released' | 'postponed' | 'cancelled';
export type DependencyType = 'blocks' | 'relates';
export type RiskLevelDb = 'low' | 'medium' | 'high' | 'critical';

export type Database = {
  public: {
    Tables: {
      organizations: {
        Row: { id: string; name: string; slug: string; created_at: string; updated_at: string };
        Insert: { id?: string; name: string; slug: string; created_at?: string; updated_at?: string };
        Update: { id?: string; name?: string; slug?: string; created_at?: string; updated_at?: string };
      };
      profiles: {
        Row: { id: string; full_name: string | null; avatar_url: string | null; created_at: string; updated_at: string };
        Insert: { id: string; full_name?: string | null; avatar_url?: string | null; created_at?: string; updated_at?: string };
        Update: { id?: string; full_name?: string | null; avatar_url?: string | null; created_at?: string; updated_at?: string };
      };
      memberships: {
        Row: { id: string; org_id: string; user_id: string; role: AppRole; created_at: string };
        Insert: { id?: string; org_id: string; user_id: string; role?: AppRole; created_at?: string };
        Update: { id?: string; org_id?: string; user_id?: string; role?: AppRole; created_at?: string };
      };
      teams: {
        Row: { id: string; org_id: string; name: string; kind: TeamKind; created_at: string; updated_at: string };
        Insert: { id?: string; org_id: string; name: string; kind?: TeamKind; created_at?: string; updated_at?: string };
        Update: { id?: string; org_id?: string; name?: string; kind?: TeamKind; created_at?: string; updated_at?: string };
      };
      team_members: {
        Row: { id: string; org_id: string; team_id: string; profile_id: string; allocation_pct: number; created_at: string };
        Insert: { id?: string; org_id: string; team_id: string; profile_id: string; allocation_pct?: number; created_at?: string };
        Update: { id?: string; org_id?: string; team_id?: string; profile_id?: string; allocation_pct?: number; created_at?: string };
      };
      team_capacity: {
        Row: {
          id: string; org_id: string; team_id: string; period_start: string; period_end: string;
          available_hours: number; created_at: string; updated_at: string;
        };
        Insert: {
          id?: string; org_id: string; team_id: string; period_start: string; period_end: string;
          available_hours: number; created_at?: string; updated_at?: string;
        };
        Update: {
          id?: string; org_id?: string; team_id?: string; period_start?: string; period_end?: string;
          available_hours?: number; created_at?: string; updated_at?: string;
        };
      };
      absences: {
        Row: {
          id: string; org_id: string; profile_id: string; start_date: string; end_date: string;
          reason: string | null; created_at: string;
        };
        Insert: {
          id?: string; org_id: string; profile_id: string; start_date: string; end_date: string;
          reason?: string | null; created_at?: string;
        };
        Update: {
          id?: string; org_id?: string; profile_id?: string; start_date?: string; end_date?: string;
          reason?: string | null; created_at?: string;
        };
      };
      projects: {
        Row: { id: string; org_id: string; name: string; key: string; created_at: string; updated_at: string };
        Insert: { id?: string; org_id: string; name: string; key: string; created_at?: string; updated_at?: string };
        Update: { id?: string; org_id?: string; name?: string; key?: string; created_at?: string; updated_at?: string };
      };
      releases: {
        Row: {
          id: string; org_id: string; project_id: string; name: string; status: ReleaseStatus;
          planned_date: string; started_at: string | null; released_at: string | null;
          created_at: string; updated_at: string;
        };
        Insert: {
          id?: string; org_id: string; project_id: string; name: string; status?: ReleaseStatus;
          planned_date: string; started_at?: string | null; released_at?: string | null;
          created_at?: string; updated_at?: string;
        };
        Update: {
          id?: string; org_id?: string; project_id?: string; name?: string; status?: ReleaseStatus;
          planned_date?: string; started_at?: string | null; released_at?: string | null;
          created_at?: string; updated_at?: string;
        };
      };
      tasks: {
        Row: {
          id: string; org_id: string; project_id: string; release_id: string | null;
          external_key: string | null; title: string; description: string | null;
          status: TaskStatus; priority: TaskPriority; estimate_h: number; spent_h: number;
          team_id: string | null; assignee_id: string | null;
          added_to_release_at: string | null; blocked_since: string | null;
          created_at: string; updated_at: string;
        };
        Insert: {
          id?: string; org_id: string; project_id: string; release_id?: string | null;
          external_key?: string | null; title: string; description?: string | null;
          status?: TaskStatus; priority?: TaskPriority; estimate_h: number; spent_h?: number;
          team_id?: string | null; assignee_id?: string | null;
          added_to_release_at?: string | null; blocked_since?: string | null;
          created_at?: string; updated_at?: string;
        };
        Update: {
          id?: string; org_id?: string; project_id?: string; release_id?: string | null;
          external_key?: string | null; title?: string; description?: string | null;
          status?: TaskStatus; priority?: TaskPriority; estimate_h?: number; spent_h?: number;
          team_id?: string | null; assignee_id?: string | null;
          added_to_release_at?: string | null; blocked_since?: string | null;
          created_at?: string; updated_at?: string;
        };
      };
      task_dependencies: {
        Row: {
          id: string; org_id: string; blocker_task_id: string; blocked_task_id: string;
          type: DependencyType; created_at: string;
        };
        Insert: {
          id?: string; org_id: string; blocker_task_id: string; blocked_task_id: string;
          type?: DependencyType; created_at?: string;
        };
        Update: {
          id?: string; org_id?: string; blocker_task_id?: string; blocked_task_id?: string;
          type?: DependencyType; created_at?: string;
        };
      };
      release_snapshots: {
        Row: {
          id: string; org_id: string; release_id: string; captured_at: string;
          readiness_pct: number; risk_score: number; risk_level: RiskLevelDb;
          probability_on_time: number | null; metrics: Json; created_at: string;
        };
        Insert: {
          id?: string; org_id: string; release_id: string; captured_at?: string;
          readiness_pct: number; risk_score: number; risk_level: RiskLevelDb;
          probability_on_time?: number | null; metrics: Json; created_at?: string;
        };
        Update: {
          id?: string; org_id?: string; release_id?: string; captured_at?: string;
          readiness_pct?: number; risk_score?: number; risk_level?: RiskLevelDb;
          probability_on_time?: number | null; metrics?: Json; created_at?: string;
        };
      };
      scenarios: {
        Row: {
          id: string; org_id: string; release_id: string; created_by: string | null;
          title: string; payload: Json; result: Json | null;
          applied_at: string | null; applied_by: string | null; created_at: string;
        };
        Insert: {
          id?: string; org_id: string; release_id: string; created_by?: string | null;
          title: string; payload: Json; result?: Json | null;
          applied_at?: string | null; applied_by?: string | null; created_at?: string;
        };
        Update: {
          id?: string; org_id?: string; release_id?: string; created_by?: string | null;
          title?: string; payload?: Json; result?: Json | null;
          applied_at?: string | null; applied_by?: string | null; created_at?: string;
        };
      };
      agent_sessions: {
        Row: {
          id: string; org_id: string; user_id: string; release_id: string | null;
          title: string | null; created_at: string; updated_at: string;
        };
        Insert: {
          id?: string; org_id: string; user_id: string; release_id?: string | null;
          title?: string | null; created_at?: string; updated_at?: string;
        };
        Update: {
          id?: string; org_id?: string; user_id?: string; release_id?: string | null;
          title?: string | null; created_at?: string; updated_at?: string;
        };
      };
      agent_messages: {
        Row: {
          id: string; org_id: string; session_id: string; role: string;
          content: string | null; tool_calls: Json | null;
          input_tokens: number | null; output_tokens: number | null; created_at: string;
        };
        Insert: {
          id?: string; org_id: string; session_id: string; role: string;
          content?: string | null; tool_calls?: Json | null;
          input_tokens?: number | null; output_tokens?: number | null; created_at?: string;
        };
        Update: {
          id?: string; org_id?: string; session_id?: string; role?: string;
          content?: string | null; tool_calls?: Json | null;
          input_tokens?: number | null; output_tokens?: number | null; created_at?: string;
        };
      };
      import_runs: {
        Row: {
          id: string; org_id: string; started_by: string | null; source: string; status: string;
          stats: Json | null; error_report: Json | null;
          started_at: string; finished_at: string | null;
        };
        Insert: {
          id?: string; org_id: string; started_by?: string | null; source: string; status?: string;
          stats?: Json | null; error_report?: Json | null;
          started_at?: string; finished_at?: string | null;
        };
        Update: {
          id?: string; org_id?: string; started_by?: string | null; source?: string; status?: string;
          stats?: Json | null; error_report?: Json | null;
          started_at?: string; finished_at?: string | null;
        };
      };
      audit_log: {
        Row: {
          id: string; org_id: string; actor_id: string | null; entity: string;
          entity_id: string | null; action: string;
          before: Json | null; after: Json | null; created_at: string;
        };
        Insert: {
          id?: string; org_id: string; actor_id?: string | null; entity: string;
          entity_id?: string | null; action: string;
          before?: Json | null; after?: Json | null; created_at?: string;
        };
        Update: {
          id?: string; org_id?: string; actor_id?: string | null; entity?: string;
          entity_id?: string | null; action?: string;
          before?: Json | null; after?: Json | null; created_at?: string;
        };
      };
    };
    Views: Record<string, never>;
    Functions: {
      create_organization: {
        Args: { p_name: string; p_slug: string };
        Returns: Database['public']['Tables']['organizations']['Row'];
      };
      owned_org_count: {
        Args: { p_user: string };
        Returns: number;
      };
    };
    Enums: {
      app_role: AppRole;
      team_kind: TeamKind;
      task_status: TaskStatus;
      task_priority: TaskPriority;
      release_status: ReleaseStatus;
      dependency_type: DependencyType;
      risk_level: RiskLevelDb;
    };
  };
};

/** Сокращения для прикладного кода: Row<'tasks'> вместо длинной цепочки. */
export type Tables = Database['public']['Tables'];
export type Row<T extends keyof Tables> = Tables[T]['Row'];
export type Insert<T extends keyof Tables> = Tables[T]['Insert'];
export type Update<T extends keyof Tables> = Tables[T]['Update'];
