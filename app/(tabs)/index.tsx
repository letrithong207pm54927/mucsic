import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, BackHandler, Easing, Linking, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

// API Token chính thức từ audd.io (Sử dụng "test" sẽ bị giới hạn kết quả theo FR-05)
const AUDD_API_TOKEN = "test"; 

const SpeechRecognition = typeof window !== 'undefined' 
  ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) 
  : null;

let recognition: any = null;
if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = false;
}

const APP_NAME = "MELODY ID";

export default function HomeScreen() {
  const [isRecording, setIsRecording] = useState(false);
  const [isScanningMusic, setIsScanningMusic] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [searchResult, setSearchResult] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [language, setLanguage] = useState('vi-VN');
  const [isLoading, setIsLoading] = useState(false);
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);

  // Karaoke & Animation
  const [lyrics, setLyrics] = useState<{time: number, text: string}[]>([]);
  const [currentLyricIndex, setCurrentLyricIndex] = useState(-1);
  const lyricOpacity = useRef(new Animated.Value(0)).current;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const spinValue = useRef(new Animated.Value(0)).current;

  // MediaRecorder dành cho chức năng Quét nhạc
  const mediaRecorderRef = useRef<any>(null);
  const audioChunksRef = useRef<any[]>([]);

  // --- FIX FR-12: TÁCH RIÊNG LOGIC THOÁT ỨNG DỤNG ---
  useEffect(() => {
    const handleBackAction = () => {
      if (Platform.OS === 'android') {
        Alert.alert("Thoát ứng dụng", "Bạn có chắc chắn muốn thoát không?", [
          { text: "Hủy", style: "cancel" },
          { text: "Thoát", onPress: () => BackHandler.exitApp() }
        ]);
        return true; // Ngăn chặn hành vi back mặc định
      }
      return false;
    };

    const backHandler = BackHandler.addEventListener("hardwareBackPress", handleBackAction);
    return () => backHandler.remove();
  }, []); // Mảng phụ thuộc rỗng để luôn lắng nghe sự kiện thoát

  useEffect(() => {
    loadHistory();
    if (recognition) {
      recognition.lang = language;
      recognition.onresult = (event: any) => {
        const text = event.results[0][0].transcript;
        setTranscript(text);
        setIsLoading(true);
        processAndSearch(text);
        setIsRecording(false);
      };
      recognition.onerror = () => {
        setIsRecording(false);
        setIsLoading(false);
        Alert.alert("Thông báo", "Giọng nói không rõ hoặc không nhận diện được lời thoại. Vui lòng thử lại.");
      };
    }
  }, [language]);

  // Hiệu ứng Fade cho chữ Karaoke (Tắt useNativeDriver trên Web)
  useEffect(() => {
    lyricOpacity.setValue(0);
    Animated.timing(lyricOpacity, { 
      toValue: 1, 
      duration: 300, 
      useNativeDriver: Platform.OS !== 'web' 
    }).start();
  }, [currentLyricIndex]);

  const safeStartRecognition = () => {
    if (!recognition) return;
    try {
      clearSearch();
      recognition.stop(); 
      setTimeout(() => {
        recognition.lang = language;
        recognition.start();
        setIsRecording(true);
      }, 150); 
    } catch (e) {
      setIsRecording(true);
    }
  };

  // --- LOGIC QUÉT NHẠC ---
  const startMusicScan = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mediaRecorderRef.current.ondataavailable = (event: any) => audioChunksRef.current.push(event.data);
      mediaRecorderRef.current.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        identifyMusic(audioBlob);
      };
      clearSearch();
      setIsScanningMusic(true);
      setTranscript("Đang lắng nghe giai điệu... 🎶");
      mediaRecorderRef.current.start();
      
      // Thu âm 8 giây để tối ưu Audio Fingerprinting
      setTimeout(() => {
        if (mediaRecorderRef.current?.state === "recording") {
          mediaRecorderRef.current.stop();
          setIsScanningMusic(false);
        }
      }, 8000);
    } catch (err) { Alert.alert("Lỗi", "Không thể truy cập Microphone."); }
  };

  const identifyMusic = async (blob: Blob) => {
    setIsLoading(true);
    const formData = new FormData();
    formData.append('file', blob);
    formData.append('api_token', AUDD_API_TOKEN);
    formData.append('return', 'apple_music');
    try {
      const response = await fetch('https://api.audd.io/', { method: 'POST', body: formData });
      const data = await response.json();
      if (data.status === 'success' && data.result) {
        const res = {
          title: data.result.title,
          artist: data.result.artist,
          artwork: data.result.apple_music?.artwork?.url.replace('{w}x{h}', '600x600') || 'https://via.assets.so/album.png?id=1&q=95&w=600&h=600',
          previewUrl: data.result.apple_music?.previews?.[0]?.url || "",
          youtubeUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(data.result.title + " " + data.result.artist)}`
        };
        setSearchResult(res);
        fetchRealLyrics(res.artist, res.title);
        saveToHistory("Quét giai điệu", res.title);
      } else {
        Alert.alert("Kết quả", "Không tìm thấy bài hát phù hợp.");
        setTranscript("");
      }
    } catch (e) { Alert.alert("Lỗi", "Kết nối máy chủ thất bại."); } finally { setIsLoading(false); }
  };

  const processAndSearch = async (text: string) => {
    let cleanText = text.toLowerCase().replace(/tìm bài hát|tìm bài|hát bài|mở bài|[.,?]/g, "").trim();
    if (!cleanText) return setIsLoading(false);
    
    try {
      const countryCode = language === 'vi-VN' ? 'VN' : 'US';
      const response = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(cleanText)}&entity=song&limit=1&country=${countryCode}`);
      const data = await response.json();
      if (data.results?.length > 0) {
        const song = data.results[0];
        const res = { 
          title: song.trackName, artist: song.artistName, 
          artwork: song.artworkUrl100.replace('100x100bb', '600x600bb'), 
          previewUrl: song.previewUrl,
          youtubeUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(song.trackName + " " + song.artistName)}`
        };
        setSearchResult(res);
        fetchRealLyrics(res.artist, res.title);
        saveToHistory(cleanText, res.title);
      } else { 
        Alert.alert("Kết quả", "Không tìm thấy bài hát phù hợp."); 
      }
    } catch (e) { Alert.alert("Lỗi", "Tìm kiếm thất bại."); } finally { setIsLoading(false); }
  };

  const fetchRealLyrics = async (artist: string, title: string) => {
    try {
      const response = await fetch(`https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}`);
      const data = await response.json();
      if (data?.syncedLyrics) {
        const lines = data.syncedLyrics.split('\n').map((line: string) => {
          const match = line.match(/\[(\d+):(\d+\.\d+)\](.*)/);
          return match ? { time: parseInt(match[1]) * 60 + parseFloat(match[2]), text: match[3].trim() } : null;
        }).filter((l: any) => l !== null && l.text !== "");
        setLyrics(lines);
      } else { setLyrics([{ time: 0, text: "Lời bài hát hiện chưa đồng bộ." }]); }
    } catch (e) { setLyrics([{ time: 0, text: "Không thể tải lời." }]); }
  };

  // FIX LỖI AbortError TỪ CONSOLE
  const playPreview = () => {
    if (audioRef.current && searchResult?.previewUrl) {
      if (isPlayingPreview) { 
        audioRef.current.pause(); 
        setIsPlayingPreview(false); 
      } else { 
        audioRef.current.src = searchResult.previewUrl; 
        const playPromise = audioRef.current.play();
        if (playPromise !== undefined) {
          playPromise.then(() => setIsPlayingPreview(true)).catch(e => console.log("Playback interrupted"));
        }
      }
    }
  };

  const clearSearch = () => {
    setSearchResult(null); setLyrics([]); setIsPlayingPreview(false); setTranscript(''); setCurrentLyricIndex(-1);
    if (audioRef.current) audioRef.current.pause();
  };

  const saveToHistory = async (t: string, s: string) => {
    const updated = [{ id: Date.now(), text: t, result: s }, ...history].slice(0, 5);
    setHistory(updated);
    await AsyncStorage.setItem('@music_history', JSON.stringify(updated));
  };

  const loadHistory = async () => {
    const saved = await AsyncStorage.getItem('@music_history');
    if (saved) setHistory(JSON.parse(saved));
  };

  useEffect(() => {
    if (isPlayingPreview) {
      spinValue.setValue(0);
      Animated.loop(Animated.timing(spinValue, { 
        toValue: 1, 
        duration: 5000, 
        easing: Easing.linear, 
        useNativeDriver: Platform.OS !== 'web' 
      })).start();
    } else { spinValue.stopAnimation(); }
  }, [isPlayingPreview]);

  const spin = spinValue.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View style={styles.container}>
      {Platform.OS === 'web' && (
        <audio 
          ref={audioRef} 
          onTimeUpdate={() => {
            if (audioRef.current && lyrics.length > 0) {
              const idx = lyrics.findLastIndex(l => audioRef.current!.currentTime >= l.time);
              if (idx !== currentLyricIndex) setCurrentLyricIndex(idx);
            }
          }} 
          onEnded={() => { setIsPlayingPreview(false); setCurrentLyricIndex(-1); }} 
        />
      )}
      
      <Text style={styles.header}>{APP_NAME}</Text>

      <View style={styles.tabContainer}>
        <TouchableOpacity style={[styles.tab, language === 'vi-VN' && styles.activeTab]} onPress={() => setLanguage('vi-VN')}>
          <Text style={[styles.tabText, language === 'vi-VN' && styles.activeTabText]}>TIẾNG VIỆT</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, language === 'en-US' && styles.activeTab]} onPress={() => setLanguage('en-US')}>
          <Text style={[styles.tabText, language === 'en-US' && styles.activeTabText]}>ENGLISH</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollBody} showsVerticalScrollIndicator={false}>
        {transcript !== '' && <Text style={styles.transcript}>"{transcript}"</Text>}
        {isLoading && <ActivityIndicator size="large" color="#1DB954" style={{ marginTop: 50 }} />}

        {!isLoading && searchResult && (
          <View style={styles.resultCard}>
            <Animated.Image source={{ uri: searchResult.artwork }} style={[styles.albumArt, isPlayingPreview && { transform: [{ rotate: spin }] }]} />
            <View style={styles.lyricsContainer}>
              <Animated.View style={{ opacity: lyricOpacity }}>
                <Text style={styles.karaokeText}>
                  {currentLyricIndex >= 0 ? lyrics[currentLyricIndex].text : (isPlayingPreview ? "🎶 ... 🎶" : "Sẵn sàng!")}
                </Text>
              </Animated.View>
            </View>
            <Text style={styles.songTitle}>{searchResult.title}</Text>
            <Text style={styles.artistName}>{searchResult.artist}</Text>
            <TouchableOpacity onPress={playPreview} style={styles.playButton}>
              <Text style={styles.playButtonText}>{isPlayingPreview ? "⏹ DỪNG PHÁT" : "🎤 NGHE THỬ"}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => Linking.openURL(searchResult.youtubeUrl)} style={styles.youtubeButton}>
              <Text style={styles.youtubeButtonText}>📺 XEM TRÊN YOUTUBE</Text>
            </TouchableOpacity>
          </View>
        )}
        
        {history.length > 0 && (
          <View style={styles.historySection}>
            <Text style={styles.historyTitle}>Lịch sử tìm kiếm</Text>
            {history.map(item => (
              <View key={item.id} style={styles.historyRow}>
                <Text style={styles.historyText}>• {item.result} ({item.text})</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <View style={{ flexDirection: 'row', gap: 30 }}>
          <TouchableOpacity 
            style={[styles.recordBtn, isRecording && { borderColor: '#ff4444' }]} 
            onPress={isRecording ? () => recognition?.stop() : safeStartRecognition}
          >
            <Text style={styles.btnIcon}>{isRecording ? "🛑" : "🎤"}</Text>
            <Text style={styles.btnSub}>{isRecording ? "STOP" : "RECORD"}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.recordBtn, { borderColor: '#0084ff' }]} onPress={startMusicScan}>
            {isScanningMusic ? <ActivityIndicator color="#0084ff" /> : <Text style={styles.btnIcon}>🎵</Text>}
            <Text style={[styles.btnSub, { color: '#0084ff' }]}>QUÉT NHẠC</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity onPress={clearSearch} style={{ marginTop: 15 }}><Text style={{ color: '#444', fontSize: 12 }}>Xóa kết quả</Text></TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F0F0F' },
  header: { fontSize: 32, fontWeight: '900', color: '#1DB954', textAlign: 'center', marginTop: 40 },
  tabContainer: { flexDirection: 'row', backgroundColor: '#1E1E1E', borderRadius: 30, padding: 5, marginTop: 20, alignSelf: 'center', width: '85%' },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: 25 },
  activeTab: { backgroundColor: '#1DB954' },
  tabText: { color: '#777', fontWeight: '800', fontSize: 11 },
  activeTabText: { color: '#FFF' },
  scrollBody: { alignItems: 'center', padding: 20, paddingBottom: 200 },
  transcript: { color: '#1DB954', fontStyle: 'italic', marginVertical: 15, fontSize: 16, textAlign: 'center' },
  resultCard: { width: '100%', backgroundColor: '#1A1A1A', borderRadius: 25, padding: 25, alignItems: 'center', borderWidth: 1, borderColor: '#333' },
  albumArt: { width: 180, height: 180, borderRadius: 90, borderWidth: 4, borderColor: '#1DB954' },
  lyricsContainer: { width: '100%', minHeight: 80, justifyContent: 'center', alignItems: 'center', marginVertical: 15, padding: 10, backgroundColor: 'rgba(29, 185, 84, 0.05)', borderRadius: 15 },
  karaokeText: { color: '#1DB954', fontSize: 19, fontWeight: '900', textAlign: 'center', textTransform: 'uppercase' },
  songTitle: { color: '#FFF', fontSize: 18, fontWeight: 'bold', textAlign: 'center' },
  artistName: { color: '#1DB954', fontSize: 14, marginTop: 5 },
  playButton: { backgroundColor: '#1DB954', width: '100%', padding: 14, borderRadius: 30, marginTop: 15, alignItems: 'center' },
  playButtonText: { color: '#FFF', fontWeight: '900' },
  youtubeButton: { marginTop: 10, width: '100%', padding: 14, borderRadius: 30, alignItems: 'center', borderWidth: 1, borderColor: '#FF0000' },
  youtubeButtonText: { color: '#FF0000', fontWeight: 'bold' },
  historySection: { width: '100%', marginTop: 20, padding: 15, backgroundColor: '#151515', borderRadius: 15 },
  historyTitle: { color: '#FFF', fontWeight: 'bold', marginBottom: 5 },
  historyRow: { paddingVertical: 3 },
  historyText: { color: '#777', fontSize: 13 },
  footer: { position: 'absolute', bottom: 30, width: '100%', alignItems: 'center' },
  recordBtn: { width: 85, height: 85, borderRadius: 45, borderWidth: 2, borderColor: '#1DB954', justifyContent: 'center', alignItems: 'center', backgroundColor: '#1A1A1A' },
  btnIcon: { fontSize: 28 },
  btnSub: { fontSize: 10, color: '#1DB954', fontWeight: '900', marginTop: 4 }
});