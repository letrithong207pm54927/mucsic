import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ScrollView, Alert, BackHandler, Platform, Image, ActivityIndicator, Animated, Easing } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// FIX LỖI TYPESCRIPT: Định nghĩa kiểu dữ liệu cho Web Speech API
const SpeechRecognition = typeof window !== 'undefined' 
  ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) 
  : null;

let recognition: any = null;
if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = false;
}

// Tên APP mới
const APP_NAME = "MELODY ID"; // Tên ứng dụng VIP Pro

export default function HomeScreen() {
  const [isRecording, setIsRecording] = useState(false); // FR-02
  const [transcript, setTranscript] = useState(''); // FR-03
  const [searchResult, setSearchResult] = useState<any>(null); // FR-06
  const [history, setHistory] = useState<any[]>([]); // FR-09
  const [language, setLanguage] = useState('vi-VN'); // FR-10
  const [isLoading, setIsLoading] = useState(false); // Trạng thái loading
  const [isPlayingPreview, setIsPlayingPreview] = useState(false); // Trạng thái phát nhạc mẫu

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const spinValue = useRef(new Animated.Value(0)).current; // Dành cho hiệu ứng xoay đĩa nhạc

  useEffect(() => {
    loadHistory(); 
    if (recognition) {
      recognition.onresult = (event: any) => {
        const text = event.results[0][0].transcript;
        setTranscript(text);
        setIsLoading(true); // Bắt đầu loading khi có kết quả transcript
        processAndSearch(text); // FR-04 & FR-05
        setIsRecording(false);
      };
      recognition.onerror = () => {
        setIsRecording(false);
        setIsLoading(false);
        Alert.alert("Thông báo", "Không nhận diện được lời thoại. Thử lại nhé!"); // FR-07
      };
      recognition.onend = () => setIsRecording(false);
    }

    if (Platform.OS === 'android') {
      const backAction = () => {
        Alert.alert("Xác nhận", "Bạn muốn thoát ứng dụng?", [
          { text: "Hủy", style: "cancel" },
          { text: "Thoát", onPress: () => BackHandler.exitApp() }
        ]);
        return true;
      };
      const backHandler = BackHandler.addEventListener("hardwareBackPress", backAction);
      return () => backHandler.remove();
    }
  }, [language]);

  // Hiệu ứng xoay đĩa nhạc
  useEffect(() => {
    if (isPlayingPreview) {
      spinValue.setValue(0); // Reset animation
      Animated.loop(
        Animated.timing(spinValue, {
          toValue: 1,
          duration: 3000, // Tốc độ xoay
          easing: Easing.linear,
          useNativeDriver: true,
        })
      ).start();
    } else {
      spinValue.stopAnimation();
    }
  }, [isPlayingPreview]);

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const startRecording = () => {
    if (!recognition) return Alert.alert("Lỗi", "Trình duyệt không hỗ trợ thu âm.");
    setTranscript('');
    setSearchResult(null);
    setIsRecording(true);
    setIsLoading(false); // Đảm bảo không hiện loading khi bắt đầu ghi âm
    if (audioRef.current) { audioRef.current.pause(); setIsPlayingPreview(false); } // Dừng nhạc nếu đang phát
    recognition.lang = language; // FR-10
    recognition.start();
  };

  const stopRecording = () => { recognition?.stop(); setIsRecording(false); };

  const processAndSearch = async (text: string) => {
    const cleanText = text.trim(); 
    if (!cleanText) {
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent(cleanText)}&entity=song&limit=10&lang=vi_vn&explicit=yes`
      );
      const data = await response.json();

      if (data.results && data.results.length > 0) {
        const song = data.results[0]; // Lấy kết quả đầu tiên (thường là phù hợp nhất)
        
        const result = {
          title: song.trackName,
          artist: song.artistName,
          album: song.collectionName,
          previewUrl: song.previewUrl,
          artwork: song.artworkUrl100 ? song.artworkUrl100.replace('100x100bb', '600x600bb') : 'https://via.placeholder.com/600x600?text=No+Image', // Ảnh dự phòng
        };
        setSearchResult(result);
        saveToHistory(cleanText, result.title);
      } else {
        setSearchResult(null); 
        console.log("Không tìm thấy bài hát cho:", cleanText);
      }
    } catch (error) {
      setSearchResult(null);
      Alert.alert("Lỗi", "Kết nối máy chủ tìm kiếm thất bại.");
    } finally {
      setIsLoading(false); // Dừng loading dù có kết quả hay không
    }
  };

  const playPreview = () => {
    if (searchResult?.previewUrl && audioRef.current) {
      if (isPlayingPreview) { // Nếu đang phát thì dừng
        audioRef.current.pause();
        setIsPlayingPreview(false);
      } else { // Nếu chưa phát thì bắt đầu phát
        audioRef.current.src = searchResult.previewUrl;
        audioRef.current.play().then(() => {
          setIsPlayingPreview(true);
        }).catch(() => Alert.alert("Lỗi", "Không thể phát nhạc mẫu."));
      }
    } else if (audioRef.current && !searchResult?.previewUrl) {
      Alert.alert("Thông báo", "Không có nhạc mẫu cho bài này.");
    }
  };

  // Dừng nhạc khi preview kết thúc
  const handleAudioEnd = () => {
    setIsPlayingPreview(false);
  };

  const clearSearch = () => {
    setTranscript('');
    setSearchResult(null);
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; }
    setIsPlayingPreview(false);
  };

  const saveToHistory = async (text: string, song: string) => {
    const updated = [{ id: Date.now(), text, result: song }, ...history].slice(0, 5);
    setHistory(updated);
    await AsyncStorage.setItem('@music_history', JSON.stringify(updated));
  };

  const loadHistory = async () => {
    const saved = await AsyncStorage.getItem('@music_history');
    if (saved) setHistory(JSON.parse(saved));
  };

  return (
    <View style={styles.container}>
      {/* FR-11: Trình phát nhạc ẩn */}
      {Platform.OS === 'web' && <audio ref={audioRef} style={{ display: 'none' }} onEnded={handleAudioEnd} />}
      
      <Text style={styles.header}>{APP_NAME}</Text>

      {/* FR-10: Chọn ngôn ngữ giao diện Tab chuyên nghiệp */}
      <View style={styles.tabContainer}>
        <TouchableOpacity style={[styles.tab, language === 'vi-VN' && styles.activeTab]} onPress={() => setLanguage('vi-VN')}>
          <Text style={[styles.tabText, language === 'vi-VN' && styles.activeTabText]}>TIẾNG VIỆT</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, language === 'en-US' && styles.activeTab]} onPress={() => setLanguage('en-US')}>
          <Text style={[styles.tabText, language === 'en-US' && styles.activeTabText]}>ENGLISH</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollBody} showsVerticalScrollIndicator={false}>
        {transcript !== '' && <Text style={styles.transcript}>" {transcript} "</Text>}

        {isLoading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#1DB954" />
            <Text style={styles.loadingText}>Đang tìm nhạc...</Text>
          </View>
        )}

        {/* FR-06: Hiển thị Card kết quả với Poster ảnh bìa */}
        {!isLoading && searchResult && (
          <View style={styles.resultCard}>
            {searchResult.artwork && (
              <Animated.Image 
                source={{ uri: searchResult.artwork }} 
                style={[
                  styles.albumArt, 
                  isPlayingPreview && { transform: [{ rotate: spin }] } // Áp dụng hiệu ứng xoay
                ]} 
              />
            )}
            <View style={styles.infoBox}>
              <Text style={styles.songTitle} numberOfLines={1}>🎵 {searchResult.title}</Text>
              <Text style={styles.artistName}>👤 {searchResult.artist}</Text>
              <Text style={styles.albumName}>💿 {searchResult.album}</Text>
            </View>
            <TouchableOpacity onPress={playPreview} style={styles.playButton}>
              <Text style={styles.playButtonText}>{isPlayingPreview ? "DỪNG NHẠC MẪU" : "NGHE NHẠC MẪU"}</Text>
            </TouchableOpacity>
          </View>
        )}
        
        {/* FR-09: Lịch sử tìm kiếm */}
        {history.length > 0 && (
          <View style={styles.historySection}>
            <Text style={styles.historyTitle}>Lịch sử gần đây</Text>
            {history.map(item => (
              <View key={item.id} style={styles.historyRow}>
                <Text style={styles.historyText}>• {item.result}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Footer chứa nút Record (FR-01/02) */}
      <View style={styles.footer}>
        <TouchableOpacity 
          style={[styles.recordOuter, isRecording && styles.recordOuterActive]} 
          onPress={isRecording ? stopRecording : startRecording}
          disabled={isLoading} // Không cho bấm khi đang loading
        >
          <View style={[styles.recordInner, isRecording && {backgroundColor: '#ff4444'}]}>
            <Text style={styles.recordLabel}>{isRecording ? "STOP" : "REC"}</Text>
          </View>
        </TouchableOpacity>
        
        <TouchableOpacity onPress={clearSearch} style={styles.clearContainer}>
          <Text style={styles.clearText}>Xóa kết quả</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F0F0F', paddingHorizontal: 20 },
  header: { 
    fontSize: 32, // To hơn
    fontWeight: '900', 
    color: '#1DB954', 
    textAlign: 'center', 
    marginTop: 50, 
    letterSpacing: 4, 
    textShadowColor: 'rgba(29, 185, 84, 0.5)', // Hiệu ứng phát sáng
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10 
  },
  
  tabContainer: { flexDirection: 'row', backgroundColor: '#1E1E1E', borderRadius: 30, padding: 5, marginTop: 25, alignSelf: 'center', width: '85%' },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: 25 },
  activeTab: { backgroundColor: '#1DB954' },
  tabText: { color: '#777', fontWeight: '800', fontSize: 12 },
  activeTabText: { color: '#FFF' },

  scrollBody: { alignItems: 'center', paddingBottom: 150 },
  transcript: { color: '#1DB954', fontStyle: 'italic', marginVertical: 20, fontSize: 16, textAlign: 'center', opacity: 0.8 },
  
  // Hiệu ứng Loading
  loadingContainer: {
    marginTop: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: '#FFF',
    marginTop: 10,
    fontSize: 16,
  },

  // FR-06: Result Card (VIP Style)
  resultCard: { 
    width: '100%', 
    backgroundColor: '#1A1A1A', 
    borderRadius: 25, 
    padding: 20, 
    borderWidth: 1, 
    borderColor: '#333', 
    shadowColor: '#1DB954', 
    shadowOpacity: 0.3, 
    shadowRadius: 20, 
    elevation: 15,
    marginTop: 30, // Đẩy xuống một chút
  },
  albumArt: { 
    width: '100%', 
    height: 280, 
    borderRadius: 20, 
    marginBottom: 20,
    // Đảm bảo ảnh không bị bể
    resizeMode: 'cover', 
    overflow: 'hidden',
  },
  infoBox: { marginBottom: 20, paddingHorizontal: 5 },
  songTitle: { color: '#FFF', fontSize: 22, fontWeight: 'bold' },
  artistName: { color: '#1DB954', fontSize: 17, marginTop: 6, fontWeight: '600' },
  albumName: { color: '#666', fontSize: 14, marginTop: 4 },
  playButton: { 
    backgroundColor: '#1DB954', 
    paddingVertical: 15, 
    borderRadius: 35, 
    alignItems: 'center', 
    shadowColor: '#1DB954', 
    shadowOpacity: 0.4, 
    shadowRadius: 10 
  },
  playButtonText: { color: '#FFF', fontWeight: '900', letterSpacing: 1 },

  // FR-09: History Section
  historySection: { 
    width: '100%', 
    marginTop: 35, 
    padding: 20, 
    backgroundColor: '#151515', 
    borderRadius: 20, 
    borderLeftWidth: 4, 
    borderLeftColor: '#1DB954' 
  },
  historyTitle: { color: '#FFF', fontWeight: '800', fontSize: 15, marginBottom: 12, opacity: 0.9 },
  historyRow: { paddingVertical: 6 },
  historyText: { color: '#777', fontSize: 14 },

  // FR-01/02: Floating Footer & Record Button
  footer: { 
    position: 'absolute', 
    bottom: 40, 
    left: 0, 
    right: 0, 
    alignItems: 'center',
    zIndex: 10, // Đảm bảo footer luôn ở trên cùng
  },
  recordOuter: { 
    width: 90, 
    height: 90, 
    borderRadius: 45, 
    backgroundColor: 'rgba(29, 185, 84, 0.15)', 
    justifyContent: 'center', 
    alignItems: 'center', 
    borderWidth: 2, 
    borderColor: '#1DB954' 
  },
  recordOuterActive: { borderColor: '#ff4444', backgroundColor: 'rgba(255, 68, 68, 0.15)' },
  recordInner: { 
    width: 66, 
    height: 66, 
    borderRadius: 33, 
    backgroundColor: '#1DB954', 
    justifyContent: 'center', 
    alignItems: 'center', 
    elevation: 10 
  },
  recordLabel: { color: '#FFF', fontWeight: '900', fontSize: 15 },
  clearContainer: { marginTop: 15, padding: 10 },
  clearText: { color: '#444', textDecorationLine: 'underline', fontSize: 12, fontWeight: '600' },
});