"use client";

import { createClient } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";

type Activity = "exercise" | "reading";
type Member = { id: string; display_name: string; user_id: string | null; role: "admin" | "member" };
type Attendance = { id: string; member_id: string; activity: Activity; attended_on: string };
type PinProfile = Member & { must_change_pin: boolean };

const SESSION_KEY = "bmt_pin_session";

const PROJECT_START = "2026-08-08";
const PROJECT_END = "2026-09-04";
const fallbackMembers: Member[] = [
  { id: "1", display_name: "서윤", user_id: null, role: "member" },
  { id: "2", display_name: "민지", user_id: null, role: "member" },
  { id: "3", display_name: "지우", user_id: null, role: "member" },
  { id: "4", display_name: "현지", user_id: null, role: "member" },
  { id: "5", display_name: "하은", user_id: null, role: "member" },
];
const fallbackAttendance: Attendance[] = [
  ["1","exercise","2026-08-15"],["1","exercise","2026-08-16"],["1","reading","2026-08-15"],
  ["2","exercise","2026-08-15"],["2","reading","2026-08-15"],["2","reading","2026-08-16"],
  ["3","exercise","2026-08-15"],["3","exercise","2026-08-16"],["3","reading","2026-08-16"],
  ["4","reading","2026-08-15"],["5","exercise","2026-08-16"],
].map(([member_id,activity,attended_on], index) => ({ id: String(index), member_id, activity: activity as Activity, attended_on }));

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

function isoInSeoul(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = (type: string) => parts.find(part => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function getWeek(dateValue: string) {
  const start = new Date(`${PROJECT_START}T00:00:00+09:00`);
  const current = new Date(`${dateValue}T00:00:00+09:00`);
  const raw = Math.floor((current.getTime() - start.getTime()) / 86400000 / 7) + 1;
  return Math.min(4, Math.max(1, raw));
}

function weekRange(week: number) {
  const projectStart = new Date(`${PROJECT_START}T00:00:00+09:00`).getTime();
  const start = new Date(projectStart + (week - 1) * 7 * 86400000);
  const end = new Date(start.getTime() + 6 * 86400000);
  const startIso = isoInSeoul(start);
  const endIso = isoInSeoul(end);
  const fmt = (value: string) => `${Number(value.slice(5, 7))}월 ${Number(value.slice(8, 10))}일`;
  return { start: startIso, end: endIso, label: `${fmt(startIso)} — ${fmt(endIso)}` };
}

function Marks({ count, activity }: { count: number; activity: Activity }) {
  return <span className={`marks ${activity}`} aria-label={`3회 중 ${count}회 완료`}>
    {[0,1,2].map(i => <i className={i < count ? "done" : ""} key={i}>{i < count ? "✓" : ""}</i>)}
  </span>;
}

export default function Home() {
  const today = isoInSeoul(new Date());
  const latestAllowedDate = today < PROJECT_START ? PROJECT_START : today > PROJECT_END ? PROJECT_END : today;
  const [week, setWeek] = useState<number | "total">(getWeek(today));
  const [members, setMembers] = useState<Member[]>(supabase ? [] : fallbackMembers);
  const [attendance, setAttendance] = useState<Attendance[]>(supabase ? [] : fallbackAttendance);
  const [sessionToken, setSessionToken] = useState("");
  const [me, setMe] = useState<PinProfile | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [loginName, setLoginName] = useState("");
  const [pin, setPin] = useState("");
  const [pinOpen, setPinOpen] = useState(false);
  const [pinTarget, setPinTarget] = useState<(Member & { must_change_pin?: boolean }) | null>(null);
  const [newPin, setNewPin] = useState("");
  const [memberLines, setMemberLines] = useState("");
  const [activity, setActivity] = useState<Activity>("exercise");
  const [date, setDate] = useState(latestAllowedDate);
  const [memberId, setMemberId] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const range = weekRange(week === "total" ? 4 : week);

  const load = async (token?: string) => {
    if (!supabase) return;
    const [{ data: memberData }, { data: attendanceData }] = await Promise.all([
      supabase.from("members").select("id,display_name,user_id,role").eq("active", true).order("display_name"),
      supabase.from("attendance").select("id,member_id,activity,attended_on").gte("attended_on", PROJECT_START).lte("attended_on", PROJECT_END),
    ]);
    if (memberData) setMembers(memberData as Member[]);
    if (attendanceData) setAttendance(attendanceData as Attendance[]);
    const activeToken = token ?? window.localStorage.getItem(SESSION_KEY) ?? "";
    if (!activeToken) { setMe(null); setSessionToken(""); return; }
    const { data: profile } = await supabase.rpc("pin_session_profile", { p_token: activeToken });
    const activeProfile = profile?.ok ? profile.member as PinProfile : null;
    if (!activeProfile) {
      window.localStorage.removeItem(SESSION_KEY); setMe(null); setSessionToken(""); return;
    }
    setSessionToken(activeToken); setMe(activeProfile); setMemberId(activeProfile.id);
    if (activeProfile.must_change_pin) { setPinTarget(activeProfile); setPinOpen(true); }
  };

  useEffect(() => {
    if (!supabase) return;
    load();
    const channel = supabase.channel("bmt-attendance").on("postgres_changes", { event: "*", schema: "public", table: "attendance" }, () => load()).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const rows = useMemo(() => members.map(member => {
    const records = attendance.filter(a => a.member_id === member.id && (week === "total" || (a.attended_on >= range.start && a.attended_on <= range.end)));
    return { ...member, exercise: records.filter(a => a.activity === "exercise").length, reading: records.filter(a => a.activity === "reading").length, latest: records.map(a => a.attended_on).sort().at(-1) };
  }), [members, attendance, range.start, range.end, week]);
  const goalPerActivity = week === "total" ? 12 : 3;
  const completed = rows.filter(row => row.exercise >= goalPerActivity && row.reading >= goalPerActivity).length;
  const totalDone = rows.reduce((sum, row) => sum + Math.min(goalPerActivity,row.exercise) + Math.min(goalPerActivity,row.reading), 0);
  const percent = rows.length ? Math.round(totalDone / (rows.length * goalPerActivity * 2) * 100) : 0;

  const loginWithPin = async () => {
    if (!supabase || !loginName.trim() || pin.length !== 6) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("pin_login", { p_name: loginName.trim(), p_pin: pin });
    setBusy(false);
    if (error || !data?.ok) { setMessage(data?.error ?? "이름 또는 PIN을 확인해주세요."); return; }
    window.localStorage.setItem(SESSION_KEY, data.token); setSessionToken(data.token);
    setLoginOpen(false); setPin(""); setMessage(""); await load(data.token);
  };

  const logout = async () => {
    if (supabase && sessionToken) await supabase.rpc("pin_logout", { p_token: sessionToken });
    window.localStorage.removeItem(SESSION_KEY); setSessionToken(""); setMe(null);
  };

  const saveAttendance = async () => {
    if (!supabase || !sessionToken || !me || !memberId) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("pin_add_attendance", { p_token: sessionToken, p_member_id: memberId, p_activity: activity, p_attended_on: date });
    setBusy(false);
    if (error || !data?.ok) { setMessage(data?.error ?? error?.message ?? "저장하지 못했어요."); return; }
    setMessage("출석이 기록됐어요."); setFormOpen(false); setWeek(getWeek(date)); await load(sessionToken);
  };

  const addMembers = async () => {
    if (!supabase || me?.role !== "admin") return;
    const entries = memberLines.split("\n").map(line => line.trim()).filter(Boolean).map(line => {
      const comma = line.indexOf(",");
      return comma < 0 ? null : { name: line.slice(0, comma).trim(), pin: line.slice(comma + 1).trim() };
    });
    if (!entries.length || entries.some(entry => !entry?.name || !/^\d{6}$/.test(entry.pin))) {
      setMessage("한 줄에 ‘이름, 숫자 6자리 PIN’ 형식으로 입력해주세요."); return;
    }
    setBusy(true); setMessage("");
    const { data, error } = await supabase.rpc("pin_admin_upsert_members", { p_token: sessionToken, p_entries: entries });
    setBusy(false);
    if (error || !data?.ok) { setMessage(data?.error ?? error?.message ?? "회원 등록에 실패했어요."); return; }
    setMessage(`${data.count}명의 회원 PIN을 저장했어요.`); setMemberLines(""); await load(sessionToken);
  };

  const saveNewPin = async () => {
    if (!supabase || !sessionToken || !pinTarget || !/^\d{6}$/.test(newPin)) return;
    setBusy(true); setMessage("");
    const functionName = pinTarget.id === me?.id ? "pin_change_own_pin" : "pin_admin_reset_member_pin";
    const args = pinTarget.id === me?.id
      ? { p_token: sessionToken, p_new_pin: newPin }
      : { p_token: sessionToken, p_member_id: pinTarget.id, p_new_pin: newPin };
    const { data, error } = await supabase.rpc(functionName, args);
    setBusy(false);
    if (error || !data?.ok) { setMessage(data?.error ?? error?.message ?? "PIN을 변경하지 못했어요."); return; }
    setPinOpen(false); setPinTarget(null); setNewPin(""); setMessage("PIN을 변경했어요."); await load(sessionToken);
  };

  const openForm = (id?: string) => {
    if (!sessionToken || !me) { setLoginOpen(true); return; }
    setMemberId(me.role === "admin" && id ? id : me.id); setMessage(""); setFormOpen(true);
  };

  return <main>
    <header className="appHeader">
      <div className="identity"><span className="logo">BMT</span><div><b>BMT 출석</b><small>Better Mom Project</small></div></div>
      <div className="account">
        {me ? <><span><b>{me.display_name}</b>{me.role === "admin" ? " · 관리자" : ""}</span><button className="textButton" onClick={() => { setPinTarget(me); setNewPin(""); setMessage(""); setPinOpen(true); }}>PIN 변경</button><button className="textButton" onClick={logout}>로그아웃</button></> : <button className="loginButton" onClick={() => setLoginOpen(true)}>로그인</button>}
      </div>
    </header>

    <section className="attendancePage">
      <div className="projectMeta"><span>2026. 08. 08 — 09. 04</span><b>4 WEEKS · 주 3회</b></div>
      <div className="headline"><div><p>{week === "total" ? "4주 전체 인증 현황" : "현재 인증 현황"}</p><h1>우리는 지금<br/><em>{percent}%</em> 채웠어요.</h1></div><div className="score"><b>{completed}</b><span>/ {rows.length}명 {week === "total" ? "전체 목표 완료" : "이번 주 완료"}</span></div></div>

      <div className="weekTabs" role="tablist" aria-label="주차 및 총합 선택">{[1,2,3,4].map(w => <button role="tab" aria-selected={week === w} className={week === w ? "active" : ""} onClick={() => setWeek(w)} key={w}><b>{w}주차</b><span>{weekRange(w).label}</span></button>)}<button role="tab" aria-selected={week === "total"} className={week === "total" ? "active totalTab" : "totalTab"} onClick={() => setWeek("total")}><b>개인별 총합</b><span>4주 전체</span></button></div>

      <section className="board">
        <div className="boardTitle"><div><span>{week === "total" ? "TOTAL 4 WEEKS" : `WEEK ${String(week).padStart(2,"0")}`}</span><h2>{week === "total" ? "개인별 누적 인증" : `${range.label} 출석`}</h2></div><div className="boardActions">{me?.role === "admin" && <button className="memberButton" onClick={() => { setMessage(""); setBulkOpen(true); }}>회원 일괄 등록</button>}<button className="addButton" onClick={() => openForm()}>+ 인증 입력</button></div></div>
        <div className="columnHead"><span>회원</span><span>운동 {goalPerActivity}회</span><span>독서 {goalPerActivity}회</span><span>{week === "total" ? "달성률" : "상태"}</span></div>
        <div className="memberList">{rows.map(row => <div className="attendanceRow" key={row.id}>
          <div className="memberName"><i>{row.display_name[0]}</i><div><b>{row.display_name}</b><small>{row.latest ? `마지막 인증 ${Number(row.latest.slice(5,7))}/${Number(row.latest.slice(8,10))}` : "아직 인증 없음"}</small></div></div>
          <div className="progressCell">{week === "total" ? <span className="totalBar exercise"><i style={{width:`${Math.min(100,row.exercise / 12 * 100)}%`}}/></span> : <Marks count={Math.min(3,row.exercise)} activity="exercise"/>}<b>{Math.min(goalPerActivity,row.exercise)}/{goalPerActivity}</b></div>
          <div className="progressCell">{week === "total" ? <span className="totalBar reading"><i style={{width:`${Math.min(100,row.reading / 12 * 100)}%`}}/></span> : <Marks count={Math.min(3,row.reading)} activity="reading"/>}<b>{Math.min(goalPerActivity,row.reading)}/{goalPerActivity}</b></div>
          <div className="rowAction">{week === "total" ? <strong className="memberPercent">{Math.round((Math.min(12,row.exercise) + Math.min(12,row.reading)) / 24 * 100)}%</strong> : <span className={row.exercise >= 3 && row.reading >= 3 ? "complete" : "ongoing"}>{row.exercise >= 3 && row.reading >= 3 ? "완료" : row.exercise + row.reading === 0 ? "시작 전" : "진행 중"}</span>}{me?.role === "admin" && <><button onClick={() => openForm(row.id)}>+입력</button><button onClick={() => { setPinTarget(row); setNewPin(""); setMessage(""); setPinOpen(true); }}>PIN 재설정</button></>}</div>
        </div>)}</div>
      </section>
      <p className="notice">각 인증은 본인과 관리자만 입력할 수 있어요. 2주차에 참여해도 8월 8일부터 오늘까지 지난 기록을 입력할 수 있어요.</p>
    </section>

    {loginOpen && <div className="modalBackdrop" onMouseDown={e => e.target === e.currentTarget && setLoginOpen(false)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="login-title"><button className="close" onClick={() => setLoginOpen(false)} aria-label="닫기">×</button><span className="modalEyebrow">MEMBER LOGIN</span><h2 id="login-title">이름과 PIN으로<br/>인증하기</h2><p>관리자에게 받은 숫자 6자리 PIN을 입력해주세요.</p><label htmlFor="login-name">이름</label><input id="login-name" value={loginName} onChange={e => setLoginName(e.target.value)} placeholder="등록된 이름" maxLength={30}/><label htmlFor="login-pin">PIN</label><input id="login-pin" className="pinInput" type="password" inputMode="numeric" autoComplete="current-password" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="숫자 6자리" maxLength={6} onKeyDown={e => e.key === "Enter" && loginWithPin()}/><button className="modalPrimary" onClick={loginWithPin} disabled={busy || !supabase || !loginName.trim() || pin.length !== 6}>{busy ? "확인 중…" : "로그인"}</button>{!supabase && <small className="setupNote">Supabase 연결 후 로그인이 활성화됩니다.</small>}{message && <div className="formMessage">{message}</div>}</section></div>}

    {formOpen && <div className="modalBackdrop" onMouseDown={e => e.target === e.currentTarget && setFormOpen(false)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="form-title"><button className="close" onClick={() => setFormOpen(false)} aria-label="닫기">×</button><span className="modalEyebrow">ATTENDANCE</span><h2 id="form-title">인증 입력</h2>{me?.role === "admin" && <><label htmlFor="member">회원</label><select id="member" value={memberId} onChange={e => setMemberId(e.target.value)}>{members.map(m => <option value={m.id} key={m.id}>{m.display_name}</option>)}</select></>}<label>인증 종류</label><div className="typeButtons"><button className={activity === "exercise" ? "selected" : ""} onClick={() => setActivity("exercise")}>운동</button><button className={activity === "reading" ? "selected green" : ""} onClick={() => setActivity("reading")}>독서</button></div><label htmlFor="date">인증 날짜</label><input id="date" type="date" min={PROJECT_START} max={latestAllowedDate} value={date} onChange={e => setDate(e.target.value)}/><small className="fieldHelp">8월 8일부터 오늘까지만 선택할 수 있어요.</small><button className="modalPrimary" onClick={saveAttendance} disabled={busy}>{busy ? "저장 중…" : "출석 기록하기"}</button>{message && <div className="formMessage">{message}</div>}</section></div>}

    {bulkOpen && <div className="modalBackdrop" onMouseDown={e => e.target === e.currentTarget && setBulkOpen(false)}><section className="modal wideModal" role="dialog" aria-modal="true" aria-labelledby="bulk-title"><button className="close" onClick={() => setBulkOpen(false)} aria-label="닫기">×</button><span className="modalEyebrow">MEMBER LIST</span><h2 id="bulk-title">회원·PIN 일괄 설정</h2><p>한 줄에 한 명씩 이름과 숫자 6자리 임시 PIN을 넣어주세요.</p><label htmlFor="member-lines">이름, PIN</label><textarea id="member-lines" value={memberLines} onChange={e => setMemberLines(e.target.value)} placeholder={"김서윤, 123456\n이민지, 654321"} rows={8}/><small className="fieldHelp">기존 회원 이름을 입력하면 PIN만 다시 설정됩니다. 회원은 첫 로그인 후 자기 PIN으로 변경해요.</small><button className="modalPrimary" onClick={addMembers} disabled={busy || !memberLines.trim()}>{busy ? "저장 중…" : "회원 PIN 저장하기"}</button>{message && <div className="formMessage">{message}</div>}</section></div>}

    {pinOpen && pinTarget && <div className="modalBackdrop" onMouseDown={e => e.target === e.currentTarget && !pinTarget.must_change_pin && setPinOpen(false)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="pin-title">{!pinTarget.must_change_pin && <button className="close" onClick={() => setPinOpen(false)} aria-label="닫기">×</button>}<span className="modalEyebrow">PIN SECURITY</span><h2 id="pin-title">{pinTarget.id === me?.id ? "내 PIN 변경" : `${pinTarget.display_name} PIN 재설정`}</h2><p>{pinTarget.must_change_pin ? "안전을 위해 임시 PIN을 새 PIN으로 바꿔주세요." : "새 숫자 6자리를 입력해주세요. 이전 PIN은 더 이상 사용할 수 없어요."}</p><label htmlFor="new-pin">새 PIN</label><input id="new-pin" className="pinInput" type="password" inputMode="numeric" autoComplete="new-password" value={newPin} onChange={e => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="숫자 6자리" maxLength={6}/><button className="modalPrimary" onClick={saveNewPin} disabled={busy || newPin.length !== 6}>{busy ? "저장 중…" : "새 PIN 저장"}</button>{message && <div className="formMessage">{message}</div>}</section></div>}
  </main>;
}
