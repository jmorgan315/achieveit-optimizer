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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      api_call_logs: {
        Row: {
          created_at: string
          duration_ms: number | null
          edge_function: string
          error_message: string | null
          id: string
          input_tokens: number | null
          model: string | null
          output_tokens: number | null
          request_payload: Json | null
          response_payload: Json | null
          session_id: string
          status: string | null
          step_label: string | null
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          edge_function: string
          error_message?: string | null
          id?: string
          input_tokens?: number | null
          model?: string | null
          output_tokens?: number | null
          request_payload?: Json | null
          response_payload?: Json | null
          session_id: string
          status?: string | null
          step_label?: string | null
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          edge_function?: string
          error_message?: string | null
          id?: string
          input_tokens?: number | null
          model?: string | null
          output_tokens?: number | null
          request_payload?: Json | null
          response_payload?: Json | null
          session_id?: string
          status?: string | null
          step_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "api_call_logs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "processing_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      processing_sessions: {
        Row: {
          classification_result: Json | null
          created_at: string
          current_step: string
          document_name: string | null
          document_size_bytes: number | null
          document_type: string | null
          extraction_method: string | null
          id: string
          org_industry: string | null
          org_name: string | null
          pipeline_run_id: string | null
          status: string
          step_results: Json | null
          total_api_calls: number
          total_duration_ms: number
          total_input_tokens: number
          total_items_extracted: number | null
          total_output_tokens: number
          user_id: string | null
        }
        Insert: {
          classification_result?: Json | null
          created_at?: string
          current_step?: string
          document_name?: string | null
          document_size_bytes?: number | null
          document_type?: string | null
          extraction_method?: string | null
          id?: string
          org_industry?: string | null
          org_name?: string | null
          pipeline_run_id?: string | null
          status?: string
          step_results?: Json | null
          total_api_calls?: number
          total_duration_ms?: number
          total_input_tokens?: number
          total_items_extracted?: number | null
          total_output_tokens?: number
          user_id?: string | null
        }
        Update: {
          classification_result?: Json | null
          created_at?: string
          current_step?: string
          document_name?: string | null
          document_size_bytes?: number | null
          document_type?: string | null
          extraction_method?: string | null
          id?: string
          org_industry?: string | null
          org_name?: string | null
          pipeline_run_id?: string | null
          status?: string
          step_results?: Json | null
          total_api_calls?: number
          total_duration_ms?: number
          total_input_tokens?: number
          total_items_extracted?: number | null
          total_output_tokens?: number
          user_id?: string | null
        }
        Relationships: []
      }
      session_feedback: {
        Row: {
          actual_item_count: number
          created_at: string
          expected_item_count: number | null
          hierarchy_rating: number | null
          id: string
          item_count_delta: number | null
          open_feedback: string | null
          overall_rating: number | null
          session_id: string
          time_saved: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          actual_item_count: number
          created_at?: string
          expected_item_count?: number | null
          hierarchy_rating?: number | null
          id?: string
          item_count_delta?: number | null
          open_feedback?: string | null
          overall_rating?: number | null
          session_id: string
          time_saved?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          actual_item_count?: number
          created_at?: string
          expected_item_count?: number | null
          hierarchy_rating?: number | null
          id?: string
          item_count_delta?: number | null
          open_feedback?: string | null
          overall_rating?: number | null
          session_id?: string
          time_saved?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_feedback_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "processing_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      user_activity_log: {
        Row: {
          activity_type: string
          created_at: string
          id: string
          metadata: Json | null
          user_id: string
        }
        Insert: {
          activity_type: string
          created_at?: string
          id?: string
          metadata?: Json | null
          user_id: string
        }
        Update: {
          activity_type?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          user_id?: string
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          created_at: string
          email: string | null
          feature_flags: Json
          first_name: string | null
          id: string
          is_active: boolean
          is_admin: boolean
          last_name: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          feature_flags?: Json
          first_name?: string | null
          id: string
          is_active?: boolean
          is_admin?: boolean
          last_name?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          feature_flags?: Json
          first_name?: string | null
          id?: string
          is_active?: boolean
          is_admin?: boolean
          last_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_admin: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
