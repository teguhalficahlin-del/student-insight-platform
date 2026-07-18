import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

Deno.serve(async (req) => {
  const superadminKey = Deno.env.get('SUPERADMIN_KEY');
  const reqKey        = req.headers.get('x-superadmin-key');
  if (!superadminKey || reqKey !== superadminKey) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // Evaluasi untuk kemarin dan hari ini
    // (kemarin untuk sesi yang berakhir tapi belum dievaluasi)
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    const dates = [
      yesterday.toISOString().split('T')[0],
      today.toISOString().split('T')[0],
    ]

    const results = []

    for (const date of dates) {
      const { data, error } = await supabase.rpc(
        'fn_evaluate_teacher_indicators',
        { p_session_date: date }
      )
      if (error) {
        results.push({ date, status: 'error', message: error.message })
      } else {
        results.push({ date, status: 'ok', resolved: data?.length ?? 0 })
      }
    }

    return new Response(JSON.stringify({ results }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
