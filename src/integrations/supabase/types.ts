export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      activity_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          detail: string | null
          entity_id: string | null
          entity_type: string
          execution_id: string | null
          id: string
          result: string
          worker_id: string | null
          workflow_id: string | null
          workspace_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          detail?: string | null
          entity_id?: string | null
          entity_type?: string
          execution_id?: string | null
          id?: string
          result?: string
          worker_id?: string | null
          workflow_id?: string | null
          workspace_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          detail?: string | null
          entity_id?: string | null
          entity_type?: string
          execution_id?: string | null
          id?: string
          result?: string
          worker_id?: string | null
          workflow_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_execution_id_fkey"
            columns: ["execution_id"]
            isOneToOne: false
            referencedRelation: "executions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_log_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "ai_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_log_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_log_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_workers: {
        Row: {
          avatar_url: string | null
          color: string
          concurrency_limit: number
          created_at: string
          created_by: string | null
          description: string | null
          execution_mode: string
          execution_timeout_seconds: number
          icon: string
          id: string
          language: string
          memory_enabled: boolean
          memory_priority: number
          memory_retention_days: number
          memory_size: number
          memory_type: Database["public"]["Enums"]["memory_layer"]
          model: string | null
          name: string
          priority: number
          provider: string
          purpose: string
          region: string
          retry_count: number
          status: Database["public"]["Enums"]["worker_status"]
          tags: string[]
          timezone: string
          type: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          avatar_url?: string | null
          color?: string
          concurrency_limit?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          execution_mode?: string
          execution_timeout_seconds?: number
          icon?: string
          id?: string
          language?: string
          memory_enabled?: boolean
          memory_priority?: number
          memory_retention_days?: number
          memory_size?: number
          memory_type?: Database["public"]["Enums"]["memory_layer"]
          model?: string | null
          name: string
          priority?: number
          provider?: string
          purpose?: string
          region?: string
          retry_count?: number
          status?: Database["public"]["Enums"]["worker_status"]
          tags?: string[]
          timezone?: string
          type?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          avatar_url?: string | null
          color?: string
          concurrency_limit?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          execution_mode?: string
          execution_timeout_seconds?: number
          icon?: string
          id?: string
          language?: string
          memory_enabled?: boolean
          memory_priority?: number
          memory_retention_days?: number
          memory_size?: number
          memory_type?: Database["public"]["Enums"]["memory_layer"]
          model?: string | null
          name?: string
          priority?: number
          provider?: string
          purpose?: string
          region?: string
          retry_count?: number
          status?: Database["public"]["Enums"]["worker_status"]
          tags?: string[]
          timezone?: string
          type?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_workers_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_steps: {
        Row: {
          attempt: number
          created_at: string
          duration_ms: number | null
          error: string | null
          execution_id: string
          finished_at: string | null
          id: string
          label: string | null
          node_id: string
          node_type: string
          output: Json | null
          seq: number
          started_at: string | null
          status: Database["public"]["Enums"]["execution_status"]
          workspace_id: string
        }
        Insert: {
          attempt?: number
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          execution_id: string
          finished_at?: string | null
          id?: string
          label?: string | null
          node_id: string
          node_type: string
          output?: Json | null
          seq?: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["execution_status"]
          workspace_id: string
        }
        Update: {
          attempt?: number
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          execution_id?: string
          finished_at?: string | null
          id?: string
          label?: string | null
          node_id?: string
          node_type?: string
          output?: Json | null
          seq?: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["execution_status"]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "execution_steps_execution_id_fkey"
            columns: ["execution_id"]
            isOneToOne: false
            referencedRelation: "executions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_steps_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      executions: {
        Row: {
          attempt: number
          created_at: string
          created_by: string | null
          duration_ms: number | null
          error: string | null
          finished_at: string | null
          id: string
          input: Json
          max_attempts: number
          output: Json | null
          priority: number
          progress: number
          queued_at: string
          started_at: string | null
          status: Database["public"]["Enums"]["execution_status"]
          timeout_seconds: number
          trigger: string
          updated_at: string
          warnings: string[]
          worker_id: string | null
          workflow_id: string | null
          workflow_version: number | null
          workspace_id: string
        }
        Insert: {
          attempt?: number
          created_at?: string
          created_by?: string | null
          duration_ms?: number | null
          error?: string | null
          finished_at?: string | null
          id?: string
          input?: Json
          max_attempts?: number
          output?: Json | null
          priority?: number
          progress?: number
          queued_at?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["execution_status"]
          timeout_seconds?: number
          trigger?: string
          updated_at?: string
          warnings?: string[]
          worker_id?: string | null
          workflow_id?: string | null
          workflow_version?: number | null
          workspace_id: string
        }
        Update: {
          attempt?: number
          created_at?: string
          created_by?: string | null
          duration_ms?: number | null
          error?: string | null
          finished_at?: string | null
          id?: string
          input?: Json
          max_attempts?: number
          output?: Json | null
          priority?: number
          progress?: number
          queued_at?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["execution_status"]
          timeout_seconds?: number
          trigger?: string
          updated_at?: string
          warnings?: string[]
          worker_id?: string | null
          workflow_id?: string | null
          workflow_version?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "executions_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "ai_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "executions_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "executions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_base_versions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          knowledge_base_id: string
          label: string | null
          snapshot: Json
          version: number
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          knowledge_base_id: string
          label?: string | null
          snapshot: Json
          version: number
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          knowledge_base_id?: string
          label?: string | null
          snapshot?: Json
          version?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_base_versions_knowledge_base_id_fkey"
            columns: ["knowledge_base_id"]
            isOneToOne: false
            referencedRelation: "knowledge_bases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_base_versions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_bases: {
        Row: {
          category: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          status: Database["public"]["Enums"]["knowledge_status"]
          tags: string[]
          updated_at: string
          version: number
          workspace_id: string
        }
        Insert: {
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          status?: Database["public"]["Enums"]["knowledge_status"]
          tags?: string[]
          updated_at?: string
          version?: number
          workspace_id: string
        }
        Update: {
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          status?: Database["public"]["Enums"]["knowledge_status"]
          tags?: string[]
          updated_at?: string
          version?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_bases_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_document_versions: {
        Row: {
          created_at: string
          created_by: string | null
          document_id: string
          id: string
          label: string | null
          snapshot: Json
          version: number
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          document_id: string
          id?: string
          label?: string | null
          snapshot: Json
          version: number
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          document_id?: string
          id?: string
          label?: string | null
          snapshot?: Json
          version?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_document_versions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "knowledge_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_document_versions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_documents: {
        Row: {
          archived: boolean
          chunk_count: number
          content: string | null
          created_at: string
          created_by: string | null
          description: string | null
          error: string | null
          folder_id: string | null
          id: string
          indexed_at: string | null
          knowledge_base_id: string
          last_used_at: string | null
          mime_type: string | null
          name: string
          size_bytes: number
          source: Database["public"]["Enums"]["knowledge_source"]
          source_url: string | null
          status: Database["public"]["Enums"]["document_status"]
          storage_path: string | null
          tags: string[]
          token_estimate: number
          updated_at: string
          usage_count: number
          version: number
          workspace_id: string
        }
        Insert: {
          archived?: boolean
          chunk_count?: number
          content?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          error?: string | null
          folder_id?: string | null
          id?: string
          indexed_at?: string | null
          knowledge_base_id: string
          last_used_at?: string | null
          mime_type?: string | null
          name: string
          size_bytes?: number
          source?: Database["public"]["Enums"]["knowledge_source"]
          source_url?: string | null
          status?: Database["public"]["Enums"]["document_status"]
          storage_path?: string | null
          tags?: string[]
          token_estimate?: number
          updated_at?: string
          usage_count?: number
          version?: number
          workspace_id: string
        }
        Update: {
          archived?: boolean
          chunk_count?: number
          content?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          error?: string | null
          folder_id?: string | null
          id?: string
          indexed_at?: string | null
          knowledge_base_id?: string
          last_used_at?: string | null
          mime_type?: string | null
          name?: string
          size_bytes?: number
          source?: Database["public"]["Enums"]["knowledge_source"]
          source_url?: string | null
          status?: Database["public"]["Enums"]["document_status"]
          storage_path?: string | null
          tags?: string[]
          token_estimate?: number
          updated_at?: string
          usage_count?: number
          version?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_documents_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "knowledge_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_documents_knowledge_base_id_fkey"
            columns: ["knowledge_base_id"]
            isOneToOne: false
            referencedRelation: "knowledge_bases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_documents_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_folders: {
        Row: {
          created_at: string
          id: string
          knowledge_base_id: string
          name: string
          parent_id: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          knowledge_base_id: string
          name: string
          parent_id?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          knowledge_base_id?: string
          name?: string
          parent_id?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_folders_knowledge_base_id_fkey"
            columns: ["knowledge_base_id"]
            isOneToOne: false
            referencedRelation: "knowledge_bases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_folders_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "knowledge_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_folders_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      member_roles: {
        Row: {
          created_at: string
          id: string
          member_id: string
          role_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          member_id: string
          role_id: string
        }
        Update: {
          created_at?: string
          id?: string
          member_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_roles_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "workspace_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      memory_entries: {
        Row: {
          content: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          importance: number
          key: string
          last_used_at: string | null
          read_count: number
          size_bytes: number
          status: Database["public"]["Enums"]["memory_entry_status"]
          store_id: string
          updated_at: string
          worker_id: string | null
          workspace_id: string
          write_count: number
        }
        Insert: {
          content: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          importance?: number
          key: string
          last_used_at?: string | null
          read_count?: number
          size_bytes?: number
          status?: Database["public"]["Enums"]["memory_entry_status"]
          store_id: string
          updated_at?: string
          worker_id?: string | null
          workspace_id: string
          write_count?: number
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          importance?: number
          key?: string
          last_used_at?: string | null
          read_count?: number
          size_bytes?: number
          status?: Database["public"]["Enums"]["memory_entry_status"]
          store_id?: string
          updated_at?: string
          worker_id?: string | null
          workspace_id?: string
          write_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "memory_entries_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "memory_stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memory_entries_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "ai_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memory_entries_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      memory_events: {
        Row: {
          actor_id: string | null
          created_at: string
          detail: string | null
          entry_id: string | null
          event: Database["public"]["Enums"]["memory_event_type"]
          id: string
          store_id: string | null
          worker_id: string | null
          workspace_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          detail?: string | null
          entry_id?: string | null
          event: Database["public"]["Enums"]["memory_event_type"]
          id?: string
          store_id?: string | null
          worker_id?: string | null
          workspace_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          detail?: string | null
          entry_id?: string | null
          event?: Database["public"]["Enums"]["memory_event_type"]
          id?: string
          store_id?: string | null
          worker_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memory_events_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "memory_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memory_events_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "memory_stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memory_events_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "ai_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memory_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      memory_stores: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          enabled: boolean
          id: string
          layer: Database["public"]["Enums"]["memory_layer"]
          max_items: number
          name: string
          priority: number
          retention_days: number
          updated_at: string
          worker_id: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          enabled?: boolean
          id?: string
          layer?: Database["public"]["Enums"]["memory_layer"]
          max_items?: number
          name: string
          priority?: number
          retention_days?: number
          updated_at?: string
          worker_id?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          enabled?: boolean
          id?: string
          layer?: Database["public"]["Enums"]["memory_layer"]
          max_items?: number
          name?: string
          priority?: number
          retention_days?: number
          updated_at?: string
          worker_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memory_stores_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "ai_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memory_stores_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      model_configs: {
        Row: {
          created_at: string
          created_by: string | null
          frequency_penalty: number
          id: string
          is_default: boolean
          max_tokens: number
          model: string
          name: string
          presence_penalty: number
          provider: string
          stop_sequences: string[]
          streaming: boolean
          temperature: number
          top_p: number
          updated_at: string
          worker_id: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          frequency_penalty?: number
          id?: string
          is_default?: boolean
          max_tokens?: number
          model?: string
          name: string
          presence_penalty?: number
          provider?: string
          stop_sequences?: string[]
          streaming?: boolean
          temperature?: number
          top_p?: number
          updated_at?: string
          worker_id?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          frequency_penalty?: number
          id?: string
          is_default?: boolean
          max_tokens?: number
          model?: string
          name?: string
          presence_penalty?: number
          provider?: string
          stop_sequences?: string[]
          streaming?: boolean
          temperature?: number
          top_p?: number
          updated_at?: string
          worker_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "model_configs_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "ai_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "model_configs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions: {
        Row: {
          created_at: string
          description: string | null
          id: string
          key: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          key: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          key?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          last_login: string | null
          status: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          last_login?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          last_login?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      prompt_versions: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          id: string
          label: string | null
          prompt_id: string
          variables: Json
          version: number
          workspace_id: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string | null
          prompt_id: string
          variables?: Json
          version: number
          workspace_id: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string | null
          prompt_id?: string
          variables?: Json
          version?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prompt_versions_prompt_id_fkey"
            columns: ["prompt_id"]
            isOneToOne: false
            referencedRelation: "prompts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_versions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      prompts: {
        Row: {
          body: string
          category: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_template: boolean
          name: string
          scope: Database["public"]["Enums"]["prompt_scope"]
          tags: string[]
          updated_at: string
          variables: Json
          version: number
          worker_id: string | null
          workspace_id: string
        }
        Insert: {
          body?: string
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_template?: boolean
          name: string
          scope?: Database["public"]["Enums"]["prompt_scope"]
          tags?: string[]
          updated_at?: string
          variables?: Json
          version?: number
          worker_id?: string | null
          workspace_id: string
        }
        Update: {
          body?: string
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_template?: boolean
          name?: string
          scope?: Database["public"]["Enums"]["prompt_scope"]
          tags?: string[]
          updated_at?: string
          variables?: Json
          version?: number
          worker_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prompts_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "ai_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          created_at: string
          id: string
          permission_id: string
          role_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          permission_id: string
          role_id: string
        }
        Update: {
          created_at?: string
          id?: string
          permission_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      worker_activity: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          detail: string | null
          id: string
          worker_id: string
          workspace_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          detail?: string | null
          id?: string
          worker_id: string
          workspace_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          detail?: string | null
          id?: string
          worker_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_activity_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "ai_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_activity_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_knowledge: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          is_default: boolean
          knowledge_base_id: string
          priority: number
          updated_at: string
          worker_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          is_default?: boolean
          knowledge_base_id: string
          priority?: number
          updated_at?: string
          worker_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          is_default?: boolean
          knowledge_base_id?: string
          priority?: number
          updated_at?: string
          worker_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_knowledge_knowledge_base_id_fkey"
            columns: ["knowledge_base_id"]
            isOneToOne: false
            referencedRelation: "knowledge_bases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_knowledge_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "ai_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_knowledge_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_notes: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          id: string
          worker_id: string
          workspace_id: string
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          id?: string
          worker_id: string
          workspace_id: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          worker_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_notes_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "ai_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_notes_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_versions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          label: string | null
          snapshot: Json
          version: number
          worker_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string | null
          snapshot?: Json
          version?: number
          worker_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string | null
          snapshot?: Json
          version?: number
          worker_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_versions_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "ai_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_versions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_versions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          label: string | null
          snapshot: Json
          version: number
          workflow_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string | null
          snapshot: Json
          version: number
          workflow_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string | null
          snapshot?: Json
          version?: number
          workflow_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_versions_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_versions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_workers: {
        Row: {
          created_at: string
          id: string
          worker_id: string
          workflow_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          worker_id: string
          workflow_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          worker_id?: string
          workflow_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_workers_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "ai_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_workers_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_workers_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workflows: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          graph: Json
          id: string
          name: string
          published_at: string | null
          status: Database["public"]["Enums"]["workflow_status"]
          tags: string[]
          updated_at: string
          version: number
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          graph?: Json
          id?: string
          name: string
          published_at?: string | null
          status?: Database["public"]["Enums"]["workflow_status"]
          tags?: string[]
          updated_at?: string
          version?: number
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          graph?: Json
          id?: string
          name?: string
          published_at?: string | null
          status?: Database["public"]["Enums"]["workflow_status"]
          tags?: string[]
          updated_at?: string
          version?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflows_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_invitations: {
        Row: {
          created_at: string
          email: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["workspace_role"]
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["workspace_role"]
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["workspace_role"]
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_invitations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["workspace_role"]
          role_id: string | null
          status: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["workspace_role"]
          role_id?: string | null
          status?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["workspace_role"]
          role_id?: string | null
          status?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_role_permissions: {
        Row: {
          created_at: string
          id: string
          permission_key: string
          workspace_id: string
          workspace_role_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          permission_key: string
          workspace_id: string
          workspace_role_id: string
        }
        Update: {
          created_at?: string
          id?: string
          permission_key?: string
          workspace_id?: string
          workspace_role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_role_permissions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_role_permissions_workspace_role_id_fkey"
            columns: ["workspace_role_id"]
            isOneToOne: false
            referencedRelation: "workspace_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_roles: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_roles_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_settings: {
        Row: {
          brand_color: string | null
          created_at: string
          domain: string | null
          language: string
          region: string
          timezone: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          brand_color?: string | null
          created_at?: string
          domain?: string | null
          language?: string
          region?: string
          timezone?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          brand_color?: string | null
          created_at?: string
          domain?: string | null
          language?: string
          region?: string
          timezone?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_settings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          id: string
          logo: string | null
          name: string
          owner_user_id: string
          slug: string
          status: string
          subscription_plan: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          logo?: string | null
          name: string
          owner_user_id: string
          slug: string
          status?: string
          subscription_plan?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          logo?: string | null
          name?: string
          owner_user_id?: string
          slug?: string
          status?: string
          subscription_plan?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_workspace: {
        Args: { _name: string; _slug: string }
        Returns: string
      }
      has_workspace_role: {
        Args: {
          _roles: Database["public"]["Enums"]["workspace_role"][]
          _user_id: string
          _workspace_id: string
        }
        Returns: boolean
      }
      is_workspace_member: {
        Args: { _user_id: string; _workspace_id: string }
        Returns: boolean
      }
      member_workspace: { Args: { _member_id: string }; Returns: string }
      shares_workspace: {
        Args: { _other_user_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      document_status:
        | "uploaded"
        | "scanning"
        | "extracting"
        | "cleaning"
        | "chunking"
        | "embedding_ready"
        | "indexed"
        | "available"
        | "failed"
        | "reindex"
      execution_status:
        | "waiting"
        | "queued"
        | "running"
        | "completed"
        | "failed"
        | "cancelled"
        | "retrying"
      knowledge_source:
        | "pdf"
        | "word"
        | "excel"
        | "csv"
        | "txt"
        | "markdown"
        | "website"
        | "faq"
        | "manual"
        | "database"
        | "api"
        | "cloud_storage"
        | "notion"
        | "google_drive"
      knowledge_status: "draft" | "active" | "archived"
      memory_entry_status: "active" | "archived" | "expired"
      memory_event_type:
        | "created"
        | "updated"
        | "used"
        | "archived"
        | "expired"
        | "merged"
        | "summarized"
        | "deleted"
      memory_layer: "short_term" | "long_term" | "session" | "persistent"
      prompt_scope: "workspace" | "worker" | "system" | "shared"
      worker_status: "draft" | "active" | "paused" | "archived"
      workflow_status: "draft" | "published" | "paused" | "archived"
      workspace_role: "owner" | "admin" | "member" | "viewer"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      document_status: [
        "uploaded",
        "scanning",
        "extracting",
        "cleaning",
        "chunking",
        "embedding_ready",
        "indexed",
        "available",
        "failed",
        "reindex",
      ],
      execution_status: [
        "waiting",
        "queued",
        "running",
        "completed",
        "failed",
        "cancelled",
        "retrying",
      ],
      knowledge_source: [
        "pdf",
        "word",
        "excel",
        "csv",
        "txt",
        "markdown",
        "website",
        "faq",
        "manual",
        "database",
        "api",
        "cloud_storage",
        "notion",
        "google_drive",
      ],
      knowledge_status: ["draft", "active", "archived"],
      memory_entry_status: ["active", "archived", "expired"],
      memory_event_type: [
        "created",
        "updated",
        "used",
        "archived",
        "expired",
        "merged",
        "summarized",
        "deleted",
      ],
      memory_layer: ["short_term", "long_term", "session", "persistent"],
      prompt_scope: ["workspace", "worker", "system", "shared"],
      worker_status: ["draft", "active", "paused", "archived"],
      workflow_status: ["draft", "published", "paused", "archived"],
      workspace_role: ["owner", "admin", "member", "viewer"],
    },
  },
} as const
