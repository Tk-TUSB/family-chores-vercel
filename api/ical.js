const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const DOW_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

function pad(n) { return String(n).padStart(2, '0'); }

function dky(y, m, d) {
  return `${y}-${pad(m + 1)}-${pad(d)}`;
}

function daysInMonth(y, m) {
  return new Date(y, m + 1, 0).getDate();
}

function isChoreDay(ch, y, m, d) {
  const dw = new Date(y, m, d).getDay();
  if (ch.freq === 'custom') {
    const days = (ch.active_days || []).map(Number);
    return days.includes(dw);
  }
  if (ch.freq === 'daily') return true;
  if (ch.freq === 'weekday') return dw >= 1 && dw <= 5;
  if (ch.freq === 'weekend') return dw === 0 || dw === 6;
  if (ch.freq === 'weekly') return dw === 1;
  return false;
}

async function sbFetch(table, query = '') {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?${query}`,
    {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );
  if (!res.ok) throw new Error(`Supabase error: ${res.status}`);
  return res.json();
}

export default async function handler(req) {
  const url = new URL(req.url);

  // URLから memberId を取得
  // /ical/m1.ics → m1
  const pathParts = url.pathname.split('/');
  const fileNameWithExt = pathParts[pathParts.length - 1];
  const memberId = fileNameWithExt.replace('.ics', '');

  if (!memberId) {
    return new Response('Member ID required', { status: 400 });
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return new Response('Supabase not configured', { status: 500 });
  }

  try {
    // Supabase からデータ取得
    const [members, chores, assignments] = await Promise.all([
      sbFetch('members'),
      sbFetch('chores'),
      sbFetch('assignments')
    ]);

    const member = members.find(m => m.id === memberId);
    if (!member) {
      return new Response('Member not found', { status: 404 });
    }

    // 割り当てをマップに変換
    const asgnMap = {};
    assignments.forEach(r => {
      if (!asgnMap[r.day_key]) asgnMap[r.day_key] = {};
      asgnMap[r.day_key][r.chore_id] = r.member_ids || [];
    });

    // 今月と来月の2ヶ月分を生成
    const now = new Date();
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//FamilyChores//JA',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      `X-WR-CALNAME:${member.name}の家事`,
      'X-WR-TIMEZONE:Asia/Tokyo',
      'X-WR-CALDESC:家族の家事スケジューラー'
    ];

    for (let mi = 0; mi < 2; mi++) {
      const targetDate = new Date(now.getFullYear(), now.getMonth() + mi, 1);
      const y = targetDate.getFullYear();
      const m = targetDate.getMonth();
      const days = daysInMonth(y, m);

      for (let d = 1; d <= days; d++) {
        const k = dky(y, m, d);
        const da = asgnMap[k] || {};

        chores.forEach(ch => {
          if (!isChoreDay(ch, y, m, d)) return;
          const asgn = da[ch.id] || [];
          if (!asgn.includes(memberId)) return;

          const startTime = ch.start_time || '07:00';
          const [sh, sm] = startTime.split(':').map(Number);
          const endH = sh + 1 > 23 ? 23 : sh + 1;

          const dtStr = `${y}${pad(m + 1)}${pad(d)}`;
          const dtStart = `${dtStr}T${pad(sh)}${pad(sm)}00`;
          const dtEnd = `${dtStr}T${pad(endH)}${pad(sm)}00`;

          const uid = `${dtStr}-${ch.id}-${memberId}@family-chores`;

          lines.push('BEGIN:VEVENT');
          lines.push(`UID:${uid}`);
          lines.push(`DTSTART;TZID=Asia/Tokyo:${dtStart}`);
          lines.push(`DTEND;TZID=Asia/Tokyo:${dtEnd}`);
          lines.push(`SUMMARY:${ch.name}`);
          lines.push(`DESCRIPTION:担当：${member.name}`);
          lines.push('BEGIN:VALARM');
          lines.push('TRIGGER:-PT30M');
          lines.push('ACTION:DISPLAY');
          lines.push(`DESCRIPTION:${ch.name}の時間です`);
          lines.push('END:VALARM');
          lines.push('END:VEVENT');
        });
      }
    }

    lines.push('END:VCALENDAR');
    const icsContent = lines.join('\r\n');

    return new Response(icsContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="${member.name}.ics"`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (e) {
    return new Response(`Error: ${e.message}`, { status: 500 });
  }
}

export const config = {
  runtime: 'edge'
};
