
/*
 * SMKWD DIRECT FIREBASE BACKEND
 * Runtime: Browser -> Firebase Authentication -> Realtime Database
 * GAS is NOT used by the application runtime.
 *
 * This file keeps the old google.script.run-style API so the existing UI
 * can remain mostly unchanged while its data operations move to Firebase.
 */
(function () {
  'use strict';

  if (!window.firebase || !firebase.apps || !firebase.apps.length) { console.warn('Firebase Direct: Firebase belum diinisialisasi.'); return; }
  const SCHOOL_ID = (window.SMKWDFirebaseConfig && window.SMKWDFirebaseConfig.schoolId) || 'SMKWD';
  const TZ = 'Asia/Jakarta';

  function dbPath(path) {
    return 'schools/' + SCHOOL_ID + '/' + String(path || '').replace(/^\/+/, '');
  }
  function ref(path) { return firebase.database().ref(dbPath(path)); }
  function cleanKey(v) {
    return String(v == null ? '' : v).trim().replace(/[.#$\/\[\]]/g, '_') || '_';
  }
  function now() { return new Date(); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function dateWIB(d) {
    return new Intl.DateTimeFormat('en-CA', {timeZone: TZ, year:'numeric', month:'2-digit', day:'2-digit'}).format(d);
  }
  function timeWIB(d) {
    return new Intl.DateTimeFormat('en-GB', {timeZone: TZ, hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false}).format(d);
  }
  function hmWIB(d) { return timeWIB(d).slice(0,5); }
  function dayIndexWIB(d) {
    const s = new Intl.DateTimeFormat('en-US', {timeZone:TZ, weekday:'short'}).format(d);
    return ({Mon:'1',Tue:'2',Wed:'3',Thu:'4',Fri:'5',Sat:'6',Sun:'7'})[s];
  }
  function normalizeTime(v) {
    if (!v) return '';
    const s = String(v).trim();
    const m = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    return m ? pad(m[1]) + ':' + m[2] + ':' + (m[3] || '00') : s;
  }
  function timeMinutes(s) {
    const m = String(s || '').match(/^(\d{1,2}):(\d{2})/);
    return m ? Number(m[1])*60 + Number(m[2]) : 0;
  }
  function currentProfile() {
    const u = firebase.auth().currentUser;
    if (!u) return Promise.reject(new Error('Belum login Firebase.'));
    return ref('security/users/' + cleanKey(u.uid)).once('value').then(s => {
      const p = s.val();
      if (!p || p.active !== true) throw new Error('Akun tidak aktif atau profil Firebase belum dibuat.');
      return p;
    });
  }
  function requireRole(roles) {
    roles = Array.isArray(roles) ? roles : [roles];
    return currentProfile().then(p => {
      if (!roles.includes(String(p.role || '').toLowerCase())) {
        throw new Error('Anda tidak memiliki hak akses untuk operasi ini.');
      }
      return p;
    });
  }
  function objValues(v) {
    if (!v) return [];
    if (Array.isArray(v)) return v.filter(Boolean);
    return Object.keys(v).map(k => v[k]).filter(Boolean);
  }
  function attendanceMap(data, tanggal, kelas) {
    const out = {};
    const all = !kelas || String(kelas).toUpperCase() === 'SEMUA';
    Object.keys(data || {}).forEach(key => {
      const x = data[key] || {};
      if (String(x.tanggal || '') !== String(tanggal)) return;
      if (!all && String(x.kelas || '').trim() !== String(kelas).trim()) return;
      const nisn = String(x.nisn || key.split('_').slice(1).join('_')).replace(/^'/,'').trim();
      if (!nisn) return;
      out[nisn] = {
        status: String(x.status || '').toLowerCase(),
        jamDatang: normalizeTime(x.jamDatang),
        jamPulang: normalizeTime(x.jamPulang),
        rowIndex: x.rowIndex || key
      };
    });
    return out;
  }
  function schoolData(path) { return ref(path).once('value').then(s => s.val() || {}); }
  function setSchool(path, value) { return ref(path).set(value).then(() => value); }
  function updateSchool(path, value) { return ref(path).update(value); }
  function removeSchool(path) { return ref(path).remove(); }

  function getConfig() {
    return schoolData('shared/config').then(cfg => {
      if (cfg && cfg.key) {
        const o = {};
        Object.keys(cfg).forEach(k => { if (k !== '__classes') o[k] = cfg[k]; });
        if (cfg.__classes) o.daftarKelas = Object.values(cfg.__classes);
        return o;
      }
      return schoolData('shared/schoolSettings').then(x => {
        const o = Object.assign({}, x || {});
        return o;
      });
    });
  }

  function getStudents(filterKelas) {
    return currentProfile().then(profile => {
      const role=String(profile.role||'').toLowerCase();
      const own=String(profile.identifier||profile.nisn||'').trim();
      const source = role==='siswa'
        ? ref('shared/students/'+cleanKey(own)).once('value').then(s=>s.exists()?{[own]:s.val()}: {})
        : schoolData('shared/students');
      return source.then(data => {
        const allowed = filterKelas ? new Set(String(filterKelas).split(',').map(x=>x.trim()).filter(Boolean)) : null;
        return Object.keys(data || {}).map(k => Object.assign({nisn:k}, data[k] || {}))
          .filter(x => !allowed || allowed.has(String(x.kelas || '').trim()));
      });
    });
  }

  function getTeachers() {
    return schoolData('shared/teachers').then(data =>
      Object.keys(data || {}).map(k => Object.assign({idGuru:k}, data[k] || {}))
    );
  }

  function getHolidays() {
    return schoolData('shared/holidays').then(data =>
      Object.keys(data || {}).map(k => Object.assign({tanggal:k}, data[k] || {}))
        .sort((a,b)=>String(a.tanggal).localeCompare(String(b.tanggal)))
    );
  }

  function getAttendance() {
    return currentProfile().then(profile => {
      const role=String(profile.role||'').toLowerCase();
      if(role==='siswa'){
        const key=makeAttendanceKey(dateWIB(now()), String(profile.identifier||'').trim());
        return ref('apps/absensi_siswa/attendance/'+key).once('value').then(s=>s.exists()?{[key]:s.val()}: {});
      }
      return schoolData('apps/absensi_siswa/attendance');
    });
  }

  function ensureAdminOrTeacher() { return requireRole(['admin','guru']); }

  function login(username, password, nisn) {
    const auth = firebase.auth();
    if (nisn) {
      const n = String(nisn).trim();
      // Student accounts are provisioned as n@students.smkwd.local.
      // For legacy compatibility, an empty password falls back to NISN.
      const p = String(password || n);
      return auth.signInWithEmailAndPassword(n + '@students.smkwd.local', p)
        .then(credential => currentProfile().then(profile => ({
          success:true, uid:credential.user.uid, token:credential.user.uid,
          role:'siswa', username:profile.identifier || n, nama:profile.nama || '', kelas:profile.kelas || '', nisn:profile.identifier || n
        })));
    }

    const u = String(username || '').trim();
    const p = String(password || '');
    if (!u || !p) return Promise.resolve({success:false,message:'Username atau password salah.'});

    // Existing GAS provisioning uses synthetic emails. Try admin and guru.
    const attempts = ['admin','guru'];
    let lastErr = null;
    const tryOne = i => {
      if (i >= attempts.length) return Promise.resolve({success:false,message:'Username atau password salah.'});
      return auth.signInWithEmailAndPassword(
        u.toLowerCase().replace(/\s+/g,'_') + '@' + attempts[i] + '.smkwd.local', p
      ).then(c => currentProfile().then(profile => ({
        success:true, uid:c.user.uid, token:c.user.uid,
        role:profile.role || attempts[i], username:profile.identifier || u,
        nama:profile.nama || u, kelas:profile.kelas || '', nisn:null
      }))).catch(e => { lastErr=e; return tryOne(i+1); });
    };
    return tryOne(0);
  }

  function getDeploymentUrl() { return Promise.resolve(window.location.origin); }

  function getSiswaList(filterKelas) {
    return getStudents(filterKelas).then(data => ({success:true,data}));
  }
  function getSiswaByNisn(nisn) {
    return ref('shared/students/' + cleanKey(nisn)).once('value').then(s => {
      const x=s.val();
      return x ? {success:true,data:Object.assign({nisn:String(nisn)},x)} : {success:false,message:'Siswa tidak ditemukan'};
    });
  }
  function addSiswa(token, d) {
    return requireRole('admin').then(() => setSchool('shared/students/'+cleanKey(d.nisn), Object.assign({},d,{nisn:String(d.nisn)})))
      .then(()=>({success:true,message:'Data siswa berhasil ditambahkan.'}));
  }
  function updateSiswa(token, oldNisn, d) {
    return requireRole('admin').then(() => {
      const newN=String(d.nisn || oldNisn);
      const path='shared/students/'+cleanKey(oldNisn);
      return ref(path).once('value').then(s=>{
        if (!s.exists()) throw new Error('Siswa tidak ditemukan.');
        if (newN!==String(oldNisn)) {
          return setSchool('shared/students/'+cleanKey(newN),Object.assign({},d,{nisn:newN}))
            .then(()=>removeSchool(path));
        }
        return setSchool(path,Object.assign({},d,{nisn:newN}));
      });
    }).then(()=>({success:true,message:'Data siswa berhasil diperbarui.'}));
  }
  function deleteSiswa(token, nisn) {
    return requireRole('admin').then(()=>removeSchool('shared/students/'+cleanKey(nisn)))
      .then(()=>({success:true,message:'Data siswa berhasil dihapus.'}));
  }

  function getGuruList() {
    return getTeachers().then(data => ({success:true,data}));
  }
  function addGuru(token, username, password, kelas) {
    return requireRole('admin').then(()=>{
      const id=cleanKey(username);
      return setSchool('shared/teachers/'+id,{idGuru:username,nama:username,jabatan:'Guru',mataPelajaran:'',kelas:kelas||'',password:password||'',qrUrl:''});
    }).then(()=>({success:true,message:'Data guru berhasil ditambahkan. Akun Firebase dibuat melalui alat provisioning admin.'}));
  }
  function updateGuru(token, oldUsername, username, password, kelas) {
    return requireRole('admin').then(()=>{
      const old=cleanKey(oldUsername), neu=cleanKey(username);
      const value={idGuru:username,nama:username,jabatan:'Guru',mataPelajaran:'',kelas:kelas||'',password:password||'',qrUrl:''};
      return setSchool('shared/teachers/'+neu,value).then(()=> old!==neu ? removeSchool('shared/teachers/'+old) : null);
    }).then(()=>({success:true,message:'Data guru berhasil diperbarui.'}));
  }
  function deleteGuru(token, username) {
    return requireRole('admin').then(()=>removeSchool('shared/teachers/'+cleanKey(username)))
      .then(()=>({success:true,message:'Data guru berhasil dihapus.'}));
  }

  function getKelasList() {
    return getStudents().then(a => [...new Set(a.map(x=>String(x.kelas||'').trim()).filter(Boolean))].sort());
  }
  function getDaftarKelas() { return getKelasList(); }
  function getKelasMaster() { return getKelasList().then(data=>({success:true,data})); }

  function getAppConfig() {
    return getConfig().then(data=>({success:true,data}));
  }
  function saveAppConfig(newConfig) {
    return requireRole('admin').then(()=>{
      const current = Object.assign({},newConfig || {});
      const payload={};
      Object.keys(current).forEach(k=>{ if (k!=='daftarKelas') payload[k]=current[k]; });
      if (current.daftarKelas) {
        payload.__classes={};
        current.daftarKelas.forEach(k=>payload.__classes[cleanKey(k)]=k);
      }
      return setSchool('shared/config',payload);
    }).then(()=>({success:true,message:'Konfigurasi berhasil disimpan.'}));
  }

  function getHariLibur() { return getHolidays().then(data=>({success:true,data})); }
  function addHariLiburRange(start,end,ket) {
    return ensureAdminOrTeacher().then(()=>{
      const a=new Date(start+'T00:00:00'), b=new Date(end+'T00:00:00'), patch={};
      for(let d=new Date(a); d<=b; d.setDate(d.getDate()+1)) {
        const key=dateWIB(d); patch[cleanKey(key)]={tanggal:key,keterangan:String(ket||'')};
      }
      return updateSchool('shared/holidays',patch);
    }).then(()=>({success:true,message:'Hari libur berhasil disimpan.'}));
  }
  function deleteHariLibur(tgl) { return requireRole(['admin','guru']).then(()=>removeSchool('shared/holidays/'+cleanKey(tgl))).then(()=>({success:true,message:'Jadwal libur dihapus'})); }
  function updateHariLibur(oldDate,newDate,newKet) {
    return requireRole(['admin','guru']).then(()=>removeSchool('shared/holidays/'+cleanKey(oldDate))
      .then(()=>setSchool('shared/holidays/'+cleanKey(newDate),{tanggal:newDate,keterangan:newKet})))
      .then(()=>({success:true,message:'Hari libur berhasil diperbarui'}));
  }

  function checkTodayHoliday(cfg, holidays) {
    const today=dateWIB(now()), idx=dayIndexWIB(now()), names={1:'Senin',2:'Selasa',3:'Rabu',4:'Kamis',5:'Jumat',6:'Sabtu',7:'Minggu'};
    if (cfg.jadwal_harian && (!cfg.jadwal_harian[idx] || cfg.jadwal_harian[idx].libur)) return {libur:true,keterangan:'Libur Rutin: Hari '+names[idx]};
    if (!cfg.jadwal_harian && idx==='7') return {libur:true,keterangan:'Hari Minggu'};
    const h=(holidays||[]).find(x=>String(x.tanggal)===today);
    return h ? {libur:true,keterangan:h.keterangan||'Hari libur'} : {libur:false,keterangan:''};
  }

  function lookupSiswaForScan(key) {
    return getSiswaByNisn(key).then(r => r.success ? {success:true,nama:r.data.nama,nisn:r.data.nisn,kelas:r.data.kelas} : {success:false,message:'NISN tidak terdaftar di database.'});
  }

  function makeAttendanceKey(tanggal,nisn) { return cleanKey(tanggal+'_'+nisn); }

  function processOneScan(nisn, scannerRole, scannerKelas, selectedKelas) {
    const n=String(nisn||'').replace(/^'/,'').trim();
    if(!n) return Promise.resolve({success:false,message:'QR Code tidak valid atau kosong.'});
    return Promise.all([getSiswaByNisn(n),getAppConfig(),getHolidays(),getAttendance()])
      .then(([sr,cr,hr,att])=>{
        if(!sr.success) return {success:false,message:'NISN tidak terdaftar di database.'};
        const siswa=sr.data, cfg=Object.assign({jam_masuk_mulai:'06:00',jam_masuk_akhir:'07:15',jam_pulang_mulai:'15:00',jam_pulang_akhir:'17:00'},cr.data||{});
        const hol=checkTodayHoliday(cfg,hr.data||[]);
        if(hol.libur) return {success:false,message:'Absensi DITUTUP. '+hol.keterangan};
        const idx=dayIndexWIB(now()), sc=cfg.jadwal_harian&&cfg.jadwal_harian[idx];
        if(sc && !sc.libur) Object.assign(cfg,{jam_masuk_mulai:sc.masuk_mulai||cfg.jam_masuk_mulai,jam_masuk_akhir:sc.masuk_akhir||cfg.jam_masuk_akhir,jam_pulang_mulai:sc.pulang_mulai||cfg.jam_pulang_mulai,jam_pulang_akhir:sc.pulang_akhir||cfg.jam_pulang_akhir});
        const kelas=String(siswa.kelas||'').trim(), chosen=String(selectedKelas||'').trim();
        if(String(scannerRole).toLowerCase()==='guru' && scannerKelas) {
          const allowed=String(scannerKelas).split(',').map(x=>x.trim().toUpperCase()).filter(Boolean);
          if(allowed.length && !allowed.includes(kelas.toUpperCase())) return {success:false,message:`Ditolak! Siswa ini kelas ${kelas}. Anda hanya bisa scan kelas ${scannerKelas}.`};
        }
        if(chosen && !['AUTO','SEMUA'].includes(chosen.toUpperCase()) && kelas.toUpperCase()!==chosen.toUpperCase())
          return {success:false,message:`QR ditolak. Siswa ini kelas ${kelas}, sedangkan kelas yang dipilih adalah ${chosen}.`};

        const today=dateWIB(now()), key=makeAttendanceKey(today,n), existing=att[key];
        const nowHM=hmWIB(now()), nowFull=timeWIB(now());
        const mode=cfg.mode_absen==='masuk_saja'?'masuk_saja':'masuk_pulang';

        if(existing) {
          if(mode==='masuk_saja') return {success:false,message:`${siswa.nama} sudah absen masuk hari ini. Tidak ada absen lanjutan (mode 1x).`};
          if(existing.jamPulang) return {success:false,message:'Siswa sudah melakukan absen pulang hari ini.'};
          if(timeMinutes(nowHM)>timeMinutes(cfg.jam_pulang_akhir)) return {success:false,message:`Gagal! Batas waktu pulang (${cfg.jam_pulang_akhir}) sudah lewat.`};
          const ket=String(existing.keterangan||existing.keteranganWaktu||'');
          const newKet=timeMinutes(nowHM)<timeMinutes(cfg.jam_pulang_mulai)?(ket?(ket+' & '):'')+'Pulang Cepat':ket;
          return setSchool('apps/absensi_siswa/attendance/'+key,Object.assign({},existing,{tanggal:today,nisn:n,nama:siswa.nama,kelas, jamPulang:nowFull,keterangan:newKet,status:existing.status||'Hadir'}))
            .then(()=>({success:true,message:'Absen Pulang Berhasil ✓',type:'pulang',jamPulang:nowFull,nama:siswa.nama,kelas,status:existing.status||'Hadir'}));
        }

        if(timeMinutes(nowHM)>timeMinutes(cfg.jam_masuk_akhir)) {
          const late=Math.max(0,timeMinutes(nowHM)-timeMinutes(cfg.jam_masuk_akhir));
          return setSchool('apps/absensi_siswa/attendance/'+key,{tanggal:today,nisn:n,nama:siswa.nama,kelas,jamDatang:nowFull,jamPulang:'',keterangan:`Terlambat ${late} menit`,status:'Hadir'})
            .then(()=>({success:true,message:`Absen Masuk (Terlambat ${late} menit)`,type:'datang',jamDatang:nowFull,nama:siswa.nama,kelas,status:'Hadir',nextStep:mode==='masuk_pulang'?'Scan lagi nanti untuk absen pulang':null}));
        }
        return setSchool('apps/absensi_siswa/attendance/'+key,{tanggal:today,nisn:n,nama:siswa.nama,kelas,jamDatang:nowFull,jamPulang:'',keterangan:'Tepat Waktu',status:'Hadir'})
          .then(()=>({success:true,message:'Absen Masuk Berhasil ✓',type:'datang',jamDatang:nowFull,nama:siswa.nama,kelas,status:'Hadir',nextStep:mode==='masuk_pulang'?'Scan lagi nanti untuk absen pulang':null}));
      });
  }

  function scanAbsensi(nisn,role,kelasGuru,selectedKelas) {
    return requireRole(['admin','guru']).then(()=>processOneScan(nisn,role,kelasGuru,selectedKelas));
  }
  function batchScanAbsensi(nisnList,role,kelasGuru) {
    return requireRole(['admin','guru']).then(()=>Promise.all((nisnList||[]).map(n=>processOneScan(n,role,kelasGuru,'')))
      .then(results=>({success:true,results})));
  }

  function getAbsensiToday(nisn) {
    const today=dateWIB(now());
    return Promise.all([getAppConfig(),getHolidays(),getAttendance()]).then(([c,h,a])=>{
      const holiday=checkTodayHoliday(c.data||{},h.data||[]);
      const key=makeAttendanceKey(today,String(nisn).trim()), x=a[key];
      return {success:true,data:x?{tanggal:today,jamDatang:normalizeTime(x.jamDatang),jamPulang:normalizeTime(x.jamPulang),status:x.status}:null,isLibur:holiday.libur,keteranganLibur:holiday.keterangan};
    });
  }

  function getAbsensiList(filter) {
    filter=filter||{};
    return Promise.all([getAttendance(),getStudents()]).then(([a,s])=>{
      const by={}; s.forEach(x=>by[String(x.nisn)]=x);
      let rows=Object.keys(a||{}).map(k=>Object.assign({},a[k],{nisn:a[k].nisn||k.split('_').slice(1).join('_')}));
      if(filter.tanggal) rows=rows.filter(x=>String(x.tanggal)===String(filter.tanggal));
      if(filter.kelas) rows=rows.filter(x=>String(x.kelas||'')===String(filter.kelas));
      if(filter.nisn) rows=rows.filter(x=>String(x.nisn)===String(filter.nisn));
      rows.forEach(x=>{const s=by[String(x.nisn)]; if(s){x.nama=x.nama||s.nama;x.kelas=x.kelas||s.kelas;}});
      return {success:true,data:rows};
    });
  }

  function getMonitoringRealtime(filterKelas) {
    return Promise.all([getStudents(),getAttendance()]).then(([students,a])=>{
      const today=dateWIB(now()), idx=attendanceMap(a,today,filterKelas);
      const rows=students.filter(s=>!filterKelas || String(filterKelas).split(',').map(x=>x.trim()).includes(String(s.kelas||'').trim()))
        .map(s=>{const x=idx[String(s.nisn).trim()];return {nama:s.nama,nisn:s.nisn,kelas:s.kelas,jamDatang:x?normalizeTime(x.jamDatang):'-',jamPulang:x?normalizeTime(x.jamPulang):'-',status:x?(x.status||''):'Belum Absen',keterangan:x?(x.keterangan||'Tepat Waktu'):'-'};})
        .sort((a,b)=>a.kelas===b.kelas?a.nama.localeCompare(b.nama):String(a.kelas).localeCompare(String(b.kelas)));
      return {success:true,data:rows};
    });
  }

  function updateAbsensiStatus(token,nisn,nama,kelas,newStatus) {
    return requireRole(['admin','guru']).then(()=>{
      const today=dateWIB(now()), key=makeAttendanceKey(today,nisn);
      return ref('apps/absensi_siswa/attendance/'+key).once('value').then(s=>{
        const old=s.val()||{tanggal:today,nisn:String(nisn),nama,kelas,jamDatang:newStatus==='Hadir'?timeWIB(now()):'',jamPulang:'',keterangan:'-',status:newStatus};
        old.status=newStatus; return setSchool('apps/absensi_siswa/attendance/'+key,old);
      });
    }).then(()=>({success:true,message:'Status berhasil diubah'}));
  }

  function getDaftarHadirByKelasAndTanggal(kelas,tanggal) {
    return Promise.all([getStudents(kelas),getAttendance()]).then(([s,a])=>({success:true,data:attendanceMap(a,tanggal,kelas)}));
  }
  function getDaftarHadirDetailByKelasAndTanggal(kelas,tanggal) {
    return Promise.all([getStudents(kelas),getAttendance()]).then(([s,a])=>{
      const map=attendanceMap(a,tanggal,kelas);
      const rows=s.map(x=>Object.assign({},x,map[x.nisn]||{status:'',jamDatang:'',jamPulang:''}));
      return {success:true,data:rows};
    });
  }

  function submitPulangSatu(nisn,kelas,tanggal,namaPengirim) {
    return requireRole(['admin','guru']).then(()=>{
      const key=makeAttendanceKey(tanggal,nisn);
      return ref('apps/absensi_siswa/attendance/'+key).once('value').then(s=>{
        const x=s.val();
        if(!x) return {success:false,message:'Data absen masuk siswa ini tidak ditemukan. Pastikan sudah absen masuk.'};
        if(x.jamPulang) return {success:false,message:`${x.nama||namaPengirim} sudah tercatat pulang (${normalizeTime(x.jamPulang)}).`};
        return getAppConfig().then(c=>{
          const cfg=c.data||{}, hm=hmWIB(now()), ket=String(x.keterangan||'');
          const pulangMulai=cfg.jam_pulang_mulai||'15:00';
          if(timeMinutes(hm)<timeMinutes(pulangMulai)) x.keterangan=(ket?(ket+' & '):'')+'Pulang Cepat';
          x.jamPulang=timeWIB(now());
          return setSchool('apps/absensi_siswa/attendance/'+key,x).then(()=>({success:true,nama:x.nama,jamPulang:x.jamPulang,message:`${x.nama} berhasil dicatat pulang (${x.jamPulang})`}));
        });
      });
    });
  }
  function submitPulangGuru(pulangList,tanggal,namaPengirim) {
    return requireRole(['admin','guru']).then(()=>Promise.all((pulangList||[]).map(item=>submitPulangSatu(item.nisn,item.kelas,tanggal,namaPengirim))))
      .then(rs=>({success:true,message:`${rs.filter(x=>x.success).length} siswa berhasil dicatat pulang.`}));
  }
  function submitDaftarHadirGuru(dataList,tanggal,namaPengirim) {
    return requireRole(['admin','guru']).then(()=>{
      const updates={};
      const cfgP=getConfig();
      return cfgP.then(cfg=>{
        const nowDate=dateWIB(now()), hm=hmWIB(now()), batas=(cfg.jam_masuk_akhir||'07:15');
        (dataList||[]).forEach(d=>{
          const key=makeAttendanceKey(tanggal,d.nisn), hadir=String(d.status||'').toLowerCase()==='hadir';
          let ket='Input: '+(namaPengirim||'Guru'), jam='';
          if(tanggal===nowDate && hadir){jam=timeWIB(now());ket=timeMinutes(hm)>timeMinutes(batas)?`Terlambat ${Math.max(0,timeMinutes(hm)-timeMinutes(batas))} menit (Input: ${namaPengirim||'Guru'})`:`Tepat Waktu (Input: ${namaPengirim||'Guru'})`;}
          updates['apps/absensi_siswa/attendance/'+key]={tanggal,nisn:String(d.nisn),nama:d.nama,kelas:d.kelas,jamDatang:jam,jamPulang:'',keterangan:ket,status:d.status==='hadir'?'Hadir':(d.status||'')};
        });
        return ref('').update(updates);
      });
    }).then(()=>({success:true,message:`${(dataList||[]).length} data absensi berhasil disimpan.`}));
  }

  function getMonthlyReportData(bulan,year,kelasFilter) {
    const month=Number(bulan), y=Number(year), days=new Date(y,month+1,0).getDate();
    return Promise.all([getStudents(kelasFilter),getAttendance(),getHolidays(),getAppConfig()]).then(([students,a,hol,cfgR])=>{
      const holidaySet=new Set((hol||[]).map(x=>String(x.tanggal)));
      const jad=cfgR.data&&cfgR.data.jadwal_harian;
      const today=dateWIB(now());
      const rows=students.sort((a,b)=>String(a.nama||'').localeCompare(String(b.nama||''))).map(s=>{
        const stats={h:0,s:0,i:0,a:0,effectiveDays:0}; const dailyCodes=[];
        for(let day=1;day<=days;day++){
          const dt=new Date(y,month,day), ds=y+'-'+pad(month+1)+'-'+pad(day), jsDay=dt.getDay(), keyDay=jsDay===0?'7':String(jsDay);
          const routine=jad ? (!jad[keyDay] || jad[keyDay].libur===true) : jsDay===0;
          let code='-';
          if(routine||holidaySet.has(ds)) code='L';
          else if(ds>today) code='';
          else {
            stats.effectiveDays++;
            const x=a[makeAttendanceKey(ds,s.nisn)];
            const st=x?String(x.status||''):'';
            if(st==='Hadir'){code='H';stats.h++} else if(st==='Sakit'){code='S';stats.s++} else if(st==='Izin'){code='I';stats.i++} else {code='A';stats.a++}
          }
          dailyCodes.push({date:day,code,isHoliday:code==='L'});
        }
        stats.percent=stats.effectiveDays?Math.round(stats.h/stats.effectiveDays*100):0;
        return {nama:s.nama,nisn:s.nisn,kelas:s.kelas,dailyCodes,stats};
      });
      return {success:true,data:{daysInMonth:days,students:rows}};
    });
  }

  function getSiswaByKelas(kelas) { return getStudents(kelas).then(a=>a); }

  function importSiswaBulk(rows) {
    return requireRole('admin').then(()=>{
      const u={}; (rows||[]).forEach(x=>{const n=String(x.nisn||x.NISN||'').trim();if(n)u['shared/students/'+cleanKey(n)]=Object.assign({},x,{nisn:n});});
      return ref('').update(u);
    }).then(()=>({success:true,message:'Data siswa berhasil diimpor.'}));
  }
  function importGuruBulk(rows) {
    return requireRole('admin').then(()=>{
      const u={}; (rows||[]).forEach(x=>{const n=String(x.idGuru||x.username||x['ID Guru']||'').trim();if(n)u['shared/teachers/'+cleanKey(n)]=Object.assign({},x,{idGuru:n});});
      return ref('').update(u);
    }).then(()=>({success:true,message:'Data guru berhasil diimpor.'}));
  }
  function importHariLiburBulk(rows) {
    return requireRole(['admin','guru']).then(()=>{
      const u={};(rows||[]).forEach(x=>{const t=String(x.tanggal||x.Tanggal||'').slice(0,10);if(t)u['shared/holidays/'+cleanKey(t)]={tanggal:t,keterangan:x.keterangan||x.Keterangan||''};});
      return ref('').update(u);
    }).then(()=>({success:true,message:'Hari libur berhasil diimpor.'}));
  }

  function addKelas(nama) {
    return requireRole('admin').then(()=>getStudents()).then(()=>({success:true,message:'Kelas akan terbentuk otomatis dari data siswa. Tambahkan siswa dengan kelas '+nama+'.'}));
  }
  function updateKelas(rowIndex,namaBaru) { return Promise.resolve({success:true,message:'Kelas tidak disimpan sebagai tabel terpisah; gunakan data siswa.'}); }
  function deleteKelas(rowIndex,namaKelas) { return Promise.resolve({success:true,message:'Kelas tidak dihapus dari master siswa secara otomatis.'}); }
  function processGradePromotion(mapping) {
    return requireRole('admin').then(()=>getStudents()).then(students=>{
      const up={}; students.forEach(s=>{const tujuan=mapping && mapping[s.kelas];if(tujuan)up['shared/students/'+cleanKey(s.nisn)+'/kelas']=tujuan;});
      return ref('').update(up);
    }).then(()=>({success:true,message:'Kenaikan kelas selesai.'}));
  }
  function processIndividualPromotion(asal,tujuan,promoData) {
    return requireRole('admin').then(()=>{
      const up={};(promoData||[]).forEach(x=>{if(x.nisn)up['shared/students/'+cleanKey(x.nisn)+'/kelas']=tujuan;});
      return ref('').update(up);
    }).then(()=>({success:true,message:'Promosi siswa selesai.'}));
  }
  function archiveAndResetYear(namaArsip) {
    return requireRole('admin').then(()=>({success:true,message:'Arsip tahunan otomatis tidak dijalankan pada Firebase direct mode. Export data terlebih dahulu sebelum reset.'}));
  }

  function generateExcel(type,filters) {
    // The original UI expects a URL. Direct mode returns a local data URL generated from current data.
    return getAbsensiList(filters||{}).then(r=>{
      if(!window.XLSX) return {success:false,message:'Library XLSX belum tersedia.'};
      const ws=XLSX.utils.json_to_sheet(r.data||[]);
      const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Data');
      const blob=XLSX.write(wb,{bookType:'xlsx',type:'array'});
      const url=URL.createObjectURL(new Blob([blob],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
      return {success:true,url,message:'File Excel berhasil dibuat di perangkat.'};
    });
  }
  function getTemplateExcel(type) {
    if(!window.XLSX) return Promise.resolve({success:false,message:'Library XLSX belum tersedia.'});
    const wb=XLSX.utils.book_new(), ws=XLSX.utils.aoa_to_sheet([['Nama Lengkap','NISN','Jenis Kelamin','Tanggal Lahir','Agama','Nama Ayah','Nama Ibu','No Handphone','Kelas','Alamat']]);
    XLSX.utils.book_append_sheet(wb,ws,'Template');
    const blob=XLSX.write(wb,{bookType:'xlsx',type:'array'});
    return Promise.resolve({success:true,url:URL.createObjectURL(new Blob([blob]))});
  }

  const methods = {
    getDeploymentUrl,login,getSiswaList,getSiswaByNisn,addSiswa,updateSiswa,deleteSiswa,getGuruList,addGuru,updateGuru,deleteGuru,
    scanAbsensi,lookupSiswaForScan,batchScanAbsensi,getAbsensiToday,getAbsensiList,getKelasList,getHariLibur,addHariLiburRange,
    deleteHariLibur,getMonitoringRealtime,updateAbsensiStatus,updateHariLibur,generateExcel,getAppConfig,saveAppConfig,
    importSiswaBulk,importGuruBulk,importHariLiburBulk,getMonthlyReportData,processGradePromotion,archiveAndResetYear,
    getSiswaByKelas,processIndividualPromotion,getKelasMaster,addKelas,updateKelas,deleteKelas,getDaftarKelas,getTemplateExcel,
    getDaftarHadirByKelasAndTanggal,getDaftarHadirDetailByKelasAndTanggal,submitPulangSatu,submitPulangGuru,submitDaftarHadirGuru
  };

  window.SMKWDFirebaseDirect = { methods, getProfile:currentProfile };

  function installBridge() {
    function runner(success,failure) {
      return new Proxy({}, {
        get(_target, prop) {
          if(prop==='withSuccessHandler') return fn=>runner(fn,failure);
          if(prop==='withFailureHandler') return fn=>runner(success,fn);
          if(prop==='withUserObject') return ()=>runner(success,failure);
          if(!methods[prop]) return ()=>Promise.reject(new Error('Fungsi Firebase direct belum diimplementasikan: '+String(prop)));
          return (...args)=>Promise.resolve().then(()=>methods[prop](...args))
            .then(result=>{if(typeof success==='function')success(result);return result;})
            .catch(error=>{if(typeof failure==='function')failure(error);else console.error(error);throw error;});
        }
      });
    }
    window.google=window.google||{};
    window.google.script=window.google.script||{};
    window.google.script.run=runner(null,null);
  }

  installBridge();
  firebase.auth().onAuthStateChanged(async user=>{
    if(!user) return;
    try {
      const p=await currentProfile();
      window.currentFirebaseProfile=p;
      window.dispatchEvent(new CustomEvent('smkwd-firebase-ready',{detail:p}));
    } catch(e) {
      console.warn('Firebase profile check:',e.message);
    }
  });
})();
